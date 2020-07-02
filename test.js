const { promisify } = require('util')
const test = require('tape')
const randomAccessTest = require('random-access-test')
const racf = require('./')

const createStorage = (root) => (file, opts) => racf(`${root}/${file}`, opts)

const storage = createStorage('tests-' + Math.random())

randomAccessTest(function (name, options, callback) {
  callback(storage(name, options))
}, {})

test('write/read concurrent requests', async t => {
  const st = storage('random')

  const rand = (min, max) => Math.floor(Math.random() * max) + min
  const read = promisify(st.read.bind(st))
  const write = promisify(st.write.bind(st))

  try {
    await new Promise(resolve => st.open(() => resolve()))

    const buf = Buffer.alloc(1)

    await Promise.all([...Array(1000).keys()].map(from => {
      return write(from, buf)
    }))

    await Promise.all([...Array(1000).keys()].map(() => {
      const row = rand(0, 2)
      const from = rand(0, 1000)
      const to = 1

      if (row === 0) {
        return read(from, to)
      }
      return write(from, buf)
    }))

    t.pass('should work ok with random concurrent request')
    t.end()
  } catch (err) {
    t.end(err)
  }
})

test('write concurrent requests over the same offset different size', async t => {
  const st = storage('random')

  const write = promisify(st.write.bind(st))

  try {
    await new Promise(resolve => st.open(() => resolve()))

    await Promise.all([
      write(0, Buffer.alloc(10)),
      write(0, Buffer.alloc(1)),
      write(0, Buffer.alloc(5))
    ])

    t.pass('should write multiple requests over the same offset different size')
    t.end()
  } catch (err) {
    t.end(err)
  }
})
