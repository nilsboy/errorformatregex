const getStream = require(`get-stream`)
const spawn = require("child_process").spawn
const assert = require(`assert`)

async function run(given, options) {
  const child = spawn("bin/errorformatregex", options)
  child.stdin.write(given)
  child.stdin.end()
  child.stderr.pipe(process.stderr)
  return getStream(child.stdout)
}

test(`no error`, async () => {
  const given = `MyError: foo bar (754:10)`
  const expected = given

  assert.equal(await run(given, []), expected)
})

test(`error without location`, async () => {
  const given = `MyError: foo bar (754:10)`
  const expected = `errorformatregex: :0:0:e:MyError: foo bar (754:10)`

  assert.equal(await run(given, [`e/error/igm`]), expected)
})

test(`with filename`, async () => {
  const given = `MyError: test/main.test.js: foo bar (754:10)`
  const expected = `errorformatregex:test/main.test.js:0:0:e:MyError: test/main.test.js: foo bar (754:10)`

  assert.equal(
    await run(given, [`e/error.*?([\\w/.\\-@-]+\\/[\\w./\\-@-]+)/igm`]),
    expected
  )
})

test(`with location`, async () => {
  const given = `MyError: test/main.test.js: foo bar (754:10)`
  const expected = `errorformatregex:test/main.test.js:754:10:e:MyError: test/main.test.js: foo bar (754:10)`

  assert.equal(
    await run(given, [
      `e/error.*?([\\w/.\\-@]+\\/[\\w./\\-@]+).*?(\\d+)\\:(\\d+)/igm`,
    ]),
    expected
  )
})

test(`prefer last matching regex`, async () => {
  const given = `MyError: test/main.test.js: foo bar (754:10)`
  const expected = `errorformatregex:test/main.test.js:0:0:e:MyError: test/main.test.js: foo bar (754:10)`

  assert.equal(
    await run(given, [
      `e/error/igm`,
      `e/error.*?([\\w/.\\-@]+\\/[\\w./\\-@]+)/igm`,
    ]),
    expected
  )
})

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
  `
  const expected = `
errorformatregex:test/main.test.js:0:0:e:MyError: test/main.test.js: foo bar (754:10)
  `

  assert.equal(
    await run(given, [
      `e/error.*$/igm`,
      `e/error.*?([\\w/.\\-@]+\\/[\\w./\\-@]+)/igm`,
    ]),
    expected
  )
})

test(`delete previously matched regex`, async () => {
  const given = `
MyError: test/main.test.js: foo bar (754:10)
  `
  const expected = `
MyError: test/main.test.js: foo bar (754:10)
  `

  assert.equal(await run(given, [`e/error.*$/igm`, `d/error.*$/igm`]), expected)
})

test(`use regex to find location`, async () => {
  const given = `MyError: test/main.test.js: foo bar`
  const expected = `errorformatregex:test/main.test.js:12:0:e:MyError: test/main.test.js: foo bar`

  assert.equal(await run(given, [`r/error\: (.+?)\: (.+)$/igm`]), expected)
})
