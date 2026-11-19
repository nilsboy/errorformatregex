import fs from "node:fs";
import path from "node:path";
import neodoc from "neodoc";
import XRegExp from "xregexp";
import pkg from "../package.json" with { type: "json" };

// from https://github.com/chalk/ansi-regex/blob/main/index.js
const ansiRegex = [
  "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
  "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
].join("|");

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}

class Errorformatregex {
  constructor() {
    this.locations = [];
    // key = filename#row#col
    this.srcLocations = new Set();
    this.lineBreakIndexes = [];
    this.argv = {};
  }

  async run() {
    if (this.argv[`--debug`]) {
      this.debug = true;
    }

    this.filename = this.argv[`--filename`];

    this.findLineBreakIndexes();

    await this.findAllMatches(this.argv[`<regex>`]);

    if (this.debug) {
      console.error(`Found locations: ${this.locations.length}`);
      console.error(`Using filename: ${this.filename}`);
    }

    const output = this.addLocationPrefix().join(`\n`);
    process.stdout.write(output);
  }

  parseArgv() {
    const binName = path.basename(pkg.bin);
    return neodoc.run(
      `${binName} v${pkg.version}

${pkg.description}

Usage:
  ${binName} [options] <regex>...

Options:
  -h --help            Show this screen.
  --filename=filename  Provide filename if error format does not provide one.
  --debug              Debug output.

See the xregexp module for regex syntax and flags.

Example regex option:
  'e/error.* in file (?<file>\\S+) at (?<row>\\d+):(?<col>\\d+)/is'

Format:
  'error type/regex/regex flags'

Available error types:
  - error (e)
  - warning (w)
  - info (i)
  - normal (n)
  - delete ignore error location (d),
  - use matched file capture group as file name to find match in (r).
    example: 'r/error: (?<file>.+?): (?<location>.+)$/is'

Available capture group names:
  - file
  - row
  - col (column)
  - location

The last matching regex takes precedence.
If a file capture group is specified and the file does not exist the error
location is ignored.

To parse the result in vim the errorformat needs to be set:
let &errorformat = 'errorformatregex:%f:%l:%c:%t:%m'
`,
      {
        optionsFirst: true,
        smartOptions: true,
      },
    );
  }

  async findAllMatches(errorOptions) {
    for (const errorOption of errorOptions) {
      const [, errorType = `e`, regex, flags] =
        errorOption.match(/^(\w*)\/(.+)\/(.*)$/) || [];

      if (!regex) {
        throw new Error(`No regex found in: ${errorOption}`);
      }

      await this.findMatches(errorType, regex, flags);
    }
  }

  async findMatches(errorType, regex, flags) {
    const cregex = XRegExp(regex, flags);

    XRegExp.forEach(this.data, cregex, async (match) => {
      const location = { errorType, row: 0, col: 0 };
      const index = match.index;

      if (match[0] === ``) {
        throw new Error(`No match for regex: ${regex}.`);
      }

      let row = 0;
      for (const lineBreak of this.lineBreakIndexes) {
        if (lineBreak > index) {
          break;
        }
        row++;
      }

      location.errorIndex = index;
      location.errorRow = row;
      // location.errorCol = TBD

      // xregexp ≥5 puts named capture properties on match.groups (namespacing feature)
      const groups = match.groups || match;

      location.filename = ` `;
      if (groups.file) {
        location.filename = groups.file;
      }

      if (location.filename.match(/\S+/) && !fs.existsSync(location.filename)) {
        if (this.debug) {
          console.error(
            `Skipping entry for missing filename: ${location.filename}.`,
          );
        }
        return;
      }

      [location.row = 0] = [groups.row];
      [location.col = 0] = [groups.col];

      if (errorType === `r`) {
        location.errorType = `e`;
        const locationRegex = groups.location;
        const otherFile = new Errorformatregex();
        otherFile.argv.filename = location.filename;
        otherFile.data = fs.readFileSync(location.filename).toString();
        otherFile.argv["<regex>"] = [`e/${locationRegex}/igm`];
        otherFile.findLineBreakIndexes();
        await otherFile.findAllMatches(otherFile.argv[`<regex>`]);

        for (const otherLocation of otherFile.locations) {
          if (!otherLocation) {
            continue;
          }

          location.row = otherLocation.errorRow - 1;
          // TBD:
          // location.col = 1
          location.errorIndex = otherLocation.errorIndex;
          break;
        }
      }

      const hash = `${location.filename}#${location.row}#${location.col}`;

      // TBD allow dupliates without location?:
      // if (!this.srcLocations.has(hash)) {

      this.locations[row] = location;
      // }
      this.srcLocations.add(hash);
    });
  }

  findLineBreakIndexes() {
    for (const match of this.data.matchAll(/\n/gm)) {
      this.lineBreakIndexes.push(match.index);
    }
  }

  addLocationPrefix() {
    const prefixedData = [];
    let rowNumber = -1;
    for (let rowData of this.data.split(/\n/)) {
      // for testing errorformatregex itself
      rowData = rowData.replace(/^errorformatregex:/, ``);
      // remove potentially existing errorformat regexes.
      rowData = rowData.replace(/^(.+):(\d+):(\d+):/, ``);
      rowNumber++;
      let prefixed = rowData;
      for (const location of this.locations) {
        if (location == null) {
          continue;
        }
        if (location.errorRow !== rowNumber) {
          continue;
        }
        if (rowData === ``) {
          prefixed = `<errorformatregex: EMPTY ROW MATCH>`;
        }
        if (this.filename) {
          location.filename = this.filename;
        }
        if (!location.filename) {
          // errorformat does not match if filename is empty
          location.filename = " ";
        }
        if (location.errorType === `d`) {
          prefixed = rowData;
        } else {
          // rowData: needs to have a value to be a valid errorformat
          prefixed = `errorformatregex:${location.filename}:${location.row}:${
            location.col
          }:${location.errorType}:${rowData ? rowData : ` `}`;
        }
      }
      prefixedData.push(prefixed);
    }

    return prefixedData;
  }
}

const app = new Errorformatregex();
app.argv = app.parseArgv();
app.data = (await readStdin()).replace(new RegExp(ansiRegex, "g"), ``);
await app.run();
