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

  const read = (...args) => new Promise((resolve, reject) => {
    st.read(...args, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })

  const write = (...args) => new Promise((resolve, reject) => {
    st.write(...args, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })

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
