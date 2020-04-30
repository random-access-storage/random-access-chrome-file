const test = require('random-access-test')
const racf = require('./')

const createStorage = (root) => (file, opts) => racf(`${root}/${file}`, opts)

const storage = createStorage('tests-' + Math.random())

test(function (name, options, callback) {
  callback(storage(name, options))
}, {})
