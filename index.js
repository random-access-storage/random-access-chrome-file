const ras = require('random-access-storage')

const TYPE = {type: 'octet/stream'}
const requestFileSystem = window.requestFileSystem || window.webkitRequestFileSystem
const persistentStorage = navigator.persistentStorage || navigator.webkitPersistentStorage
const FileReader = window.FileReader
const Blob = window.Blob

createFile.DEFAULT_MAX_SIZE = Number.MAX_SAFE_INTEGER
createFile.requestQuota = requestQuota

module.exports = createFile

function requestQuota (n, force, cb) {
  if (typeof force === 'function') return requestQuota(n, true, force)
  persistentStorage.queryUsageAndQuota(function (used, quota) {
    if (quota && !force) return cb(null, quota)
    persistentStorage.requestQuota(n, function (quota) {
      cb(null, quota)
    }, cb)
  }, cb)
}

function createFile (name, opts) {
  if (!opts) opts = {}

  const maxSize = opts.maxSize || createFile.DEFAULT_MAX_SIZE
  const waiting = []
  const writers = []
  const readers = []

  var fs = null
  var file = null
  var entry = null
  var truncate = null
  var totalWriters = 0

  return ras({read, write, open, stat, close})

  function wait (req) {
    waiting.push(req)
  }

  function allocWriter (req) {
    const io = {writer: null, req: null}

    entry.createWriter(function (writer) {
      io.writer = writer
      io.writer.onerror = function (err) {
        onwrite(err)
      }
      io.writer.onwriteend = function () {
        onwrite(null)
      }

      writers.push(io)
      totalWriters++
      write(req)
    }, onallocerror)

    function onallocerror (err) {
      req.callback(err)
    }

    function onwrite (err) {
      const req = io.req
      io.req = null
      writers.push(io)

      if (truncate) {
        if (io === truncate) {
          truncate = null
          while (waiting.length) write(waiting.pop())
          write(req)
          return
        }

        if (totalWriters - writers.length === 1) {
          truncate.writer.truncate(truncate.req.offset)
        }
      }

      req.callback(err, null)
    }
  }

  function allocReader () {
    const io = {reader: null, req: null}

    io.reader = new FileReader()
    io.reader.onerror = function (err) {
      onread(err, null)
    }
    io.reader.onload = function () {
      onread(null, Buffer.from(this.result))
    }

    return io

    function onread (err, buf) {
      const req = io.req
      io.req = null
      readers.push(io)
      req.callback(err, buf)
    }
  }

  function read (req) {
    const io = readers.pop() || allocReader()
    io.req = req
    io.reader.readAsArrayBuffer(file.slice(req.offset, req.offset + req.size))
  }

  function close (req) {
    entry = file = fs = null
    req.callback(null)
  }

  function write (req) {
    if (truncate) return wait(req)

    const io = writers.pop()
    if (!io) return allocWriter(req)

    io.req = req

    if (req.offset > file.size) {
      truncate = io
      if (totalWriters - writers.length === 1) io.writer.truncate(req.offset)
      return
    }

    io.writer.seek(req.offset)
    io.writer.write(new Blob([req.data], TYPE))
  }

  function stat (req) {
    req.callback(null, file)
  }

  function open (req) {
    requestQuota(maxSize, false, function (err, granted) {
      if (err) return onerror(err)
      requestFileSystem(window.PERSISTENT, granted, function (res) {
        fs = res
        fs.root.getFile(name, {create: true}, function (e) {
          entry = e
          entry.file(function (f) {
            file = f
            req.callback(null)
          }, onerror)
        }, onerror)
      }, onerror)
    })

    function onerror (err) {
      fs = file = entry = null
      req.callback(err)
    }
  }
}
