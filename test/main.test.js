import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

async function run(given, options) {
  const child = spawn("bin/errorformatregex", options);
  const stdoutPromise = readStream(child.stdout);
  child.stdin.write(given);
  child.stdin.end();
  child.stderr.pipe(process.stderr);
  return stdoutPromise;
}

test(`no error`, async () => {
  const given = `MyError: foo bar (754:10)`;
  const expected = given;

  assert.equal(await run(given, []), expected);
});

test(`error without location`, async () => {
  const given = `MyError: foo bar (754:10)`;
  const expected = `errorformatregex: :0:0:e:MyError: foo bar (754:10)`;

  assert.equal(await run(given, [`e/error/is`]), expected);
});

test(`with filename`, async () => {
  const given = `MyError: test/main.test.js: foo bar (754:10)`;
  const expected = `errorformatregex:test/main.test.js:0:0:e:MyError: test/main.test.js: foo bar (754:10)`;

  assert.equal(
    await run(given, [`e/error.*?(?<file>[\\w/.\\-@-]+\\/[\\w./\\-@-]+)/is`]),
    expected,
  );
});

test(`with location`, async () => {
  const given = `MyError: test/main.test.js: foo bar (754:10)`;
  const expected = `errorformatregex:test/main.test.js:754:10:e:MyError: test/main.test.js: foo bar (754:10)`;

  assert.equal(
    await run(given, [
      `e/error.*?(?<file>[\\w/.\\-@]+\\/[\\w./\\-@]+).*?(?<row>\\d+)\\:(?<col>\\d+)/is`,
    ]),
    expected,
  );
});

test(`prefer last matching regex`, async () => {
  const given = `MyError: test/main.test.js: foo bar (754:10)`;
  const expected = `errorformatregex:test/main.test.js:0:0:e:MyError: test/main.test.js: foo bar (754:10)`;

  assert.equal(
    await run(given, [
      `e/error/is`,
      `e/error.*?(?<file>[\\w/.\\-@]+\\/[\\w./\\-@]+)/is`,
    ]),
    expected,
  );
});

// TBD: good idea?
// test(`only match first of two matching lines of same location`, async () => {
//   const given = `
// MyError: first: foo bar
// MyError: second: foo bar
// `
//   const expected = `
// errorformatregex: :0:0:e:MyError: first: foo bar
// MyError: second: foo bar
// `

//   assert.equal(await run(given, [`e/error/ig`]), expected)
// })

test(`use last matching regex`, async () => {
  const given = `
MyError: test/main.test.js: foo bar (754:10)
  `;
  const expected = `
errorformatregex:test/main.test.js:0:0:e:MyError: test/main.test.js: foo bar (754:10)
  `;

  assert.equal(
    await run(given, [
      `e/error.*$/is`,
      `e/error.*?(?<file>[\\w/.\\-@]+\\/[\\w./\\-@]+)/is`,
    ]),
    expected,
  );
});

test(`delete previously matched regex`, async () => {
  const given = `
MyError: test/main.test.js: foo bar (754:10)
  `;
  const expected = `
MyError: test/main.test.js: foo bar (754:10)
  `;

  assert.equal(await run(given, [`e/error.*$/is`, `d/error.*$/is`]), expected);
});

test(`use regex to find location`, async () => {
  const given = `MyError: test/main.test.js: foo bar`;
  // row tracks the first `foo bar` in this test file (update if lines above shift)
  const expected = `errorformatregex:test/main.test.js:19:0:e:MyError: test/main.test.js: foo bar`;

  assert.equal(
    await run(given, [`r/error: (?<file>.+?): (?<location>.+)$/is`]),
    expected,
  );
});
