const finished = require('tap-finished')

let stream = null

module.exports = {
  beforeAll ({ shutdown }) {
    stream = finished(function (results) {
      if (results.ok) {
        return shutdown(0)
      }
      shutdown(1)
    })
  },
  onMessage (msg) {
    stream.write(msg + '\n')
  }
}
