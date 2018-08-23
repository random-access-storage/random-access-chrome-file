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
  const mutex = new Mutex()

  var fs = null
  var file = null
  var entry = null
  var readers = []
  var writers = []

  return ras({read, write, open, stat, close})

  function read (req) {
    const r = readers.pop() || new ReadRequest(readers, file, entry, mutex)
    r.run(req)
  }

  function write (req) {
    const w = writers.pop() || new WriteRequest(writers, file, entry, mutex)
    w.run(req)
  }

  function close (req) {
    readers = writers = entry = file = fs = null
    req.callback(null)
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

function WriteRequest (pool, file, entry, mutex) {
  this.writer = null
  this.entry = entry
  this.file = file
  this.req = null
  this.pool = pool
  this.mutex = mutex
  this.locked = false
  this.truncating = false
}

WriteRequest.prototype.makeWriter = function () {
  const self = this
  this.entry.createWriter(function (writer) {
    self.writer = writer

    writer.onwriteend = function () {
      if (self.writer !== writer) throw new Error('nah')
      self.onwrite(null)
    }

    writer.onerror = function (err) {
      if (self.writer !== writer) throw new Error('nah')
      console.log('ONERROR', arguments)
      self.onwrite(err)
    }

    self.run(self.req)
  })
}

WriteRequest.prototype.onwrite = function (err) {
  const req = this.req
  this.req = null

  if (this.locked) {
    this.locked = false
    this.mutex.release()
  }

  if (this.truncating) {
    this.truncating = false
    if (!err) return this.run(req)
  }

  this.pool.push(this)
  if (err) console.log('ERROR HERE', err)
  req.callback(err, null)
}

WriteRequest.prototype.truncate = function () {
  this.truncating = true
  this.writer.truncate(this.req.offset)
}

WriteRequest.prototype.lock = function () {
  if (this.locked) return true
  this.locked = this.mutex.lock(this)
  return this.locked
}

WriteRequest.prototype.run = function (req) {
  this.req = req
  if (!this.writer || this.writer.length !== this.file.size) return this.makeWriter()

  const end = req.offset + req.size
  if (end > this.file.size && !this.lock()) return

  if (req.offset > this.writer.length) {
    if (req.offset > this.file.size) return this.truncate()
    return this.makeWriter()
  }

  this.writer.seek(req.offset)
  this.writer.write(new Blob([req.data], TYPE))
}

function Mutex () {
  this.queued = null
}

Mutex.prototype.release = function () {
  const queued = this.queued
  this.queued = null
  for (var i = 0; i < queued.length; i++) {
    queued[i].run(queued[i].req)
  }
}

Mutex.prototype.lock = function (req) {
  if (this.queued) {
    this.queued.push(req)
    return false
  }
  this.queued = []
  return true
}

function ReadRequest (pool, file, entry, mutex) {
  this.reader = new FileReader()
  this.file = file
  this.req = null
  this.pool = pool
  this.retry = true
  this.mutex = mutex
  this.locked = false

  const self = this

  this.reader.onerror = function () {
    self.onread(this.error, null)
  }

  this.reader.onload = function () {
    const buf = Buffer.from(this.result)
    self.onread(null, buf)
  }
}

ReadRequest.prototype.lock = function () {
  if (this.locked) return true
  this.locked = this.mutex.lock(this)
  return this.locked
}

ReadRequest.prototype.onread = function (err, buf) {
  const req = this.req

  if (err && this.retry) {
    this.retry = false
    if (this.lock(this)) this.run(req)
    return
  }

  this.req = null
  this.pool.push(this)
  this.retry = true

  if (this.locked) {
    this.locked = false
    this.mutex.release()
  }

  req.callback(err, buf)
}

ReadRequest.prototype.run = function (req) {
  const end = req.offset + req.size
  this.req = req
  if (end > this.file.size) return this.onread(new Error('Could not satisfy length'), null)
  this.reader.readAsArrayBuffer(this.file.slice(req.offset, end))
}