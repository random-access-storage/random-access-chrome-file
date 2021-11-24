const ras = require('random-access-storage')

const TYPE = { type: 'octet/stream' }
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

  let fs = null
  let entry = null
  let toDestroy = null
  let readers = []
  let writers = []
  let deleters = []

  return ras({ read, write, del, open, stat, close, destroy })

  function read (req) {
    const r = readers.pop() || new ReadRequest(readers, entry, mutex)
    r.run(req)
  }

  function write (req) {
    const w = writers.pop() || new WriteRequest(writers, entry, mutex)
    w.run(req)
  }

  function del (req) {
    const d = deleters.pop() || new DeleteRequest(deleters, entry, mutex)
    d.run(req)
  }

  function close (req) {
    readers = writers = deleters = entry = fs = null
    req.callback(null)
  }

  function stat (req) {
    entry.file(file => {
      req.callback(null, file)
    }, err => req.callback(err))
  }

  function destroy (req) {
    toDestroy.remove(ondone, onerror)

    function ondone () {
      toDestroy = null
      req.callback(null, null)
    }

    function onerror (err) {
      toDestroy = null
      req.callback(err, null)
    }
  }

  function open (req) {
    requestQuota(maxSize, false, function (err, granted) {
      if (err) return onerror(err)
      requestFileSystem(window.PERSISTENT, granted, function (res) {
        fs = res
        mkdirp(parentFolder(name), function () {
          fs.root.getFile(name, { create: true }, function (e) {
            entry = toDestroy = e
            req.callback(null)
          }, onerror)
        })
      }, onerror)
    })

    function mkdirp (name, ondone) {
      if (!name) return ondone()
      fs.root.getDirectory(name, { create: true }, ondone, function () {
        mkdirp(parentFolder(name), function () {
          fs.root.getDirectory(name, { create: true }, ondone, ondone)
        })
      })
    }

    function onerror (err) {
      fs = entry = null
      req.callback(err)
    }
  }
}

function parentFolder (path) {
  const i = path.lastIndexOf('/')
  const j = path.lastIndexOf('\\')
  const p = path.slice(0, Math.max(0, i, j))
  return /^\w:$/.test(p) ? '' : p
}

function WriteRequest (pool, entry, mutex) {
  this.pool = pool
  this.entry = entry
  this.mutex = mutex
  this.writer = null
  this.req = null
  this.locked = false
  this.truncating = false
}

WriteRequest.prototype.makeWriter = function () {
  const self = this
  this.entry.createWriter(function (writer) {
    self.writer = writer

    writer.onwriteend = function () {
      self.onwrite(null)
    }

    writer.onerror = function (err) {
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
  this.entry.file(file => {
    this.req = req

    if (!this.writer || this.writer.length !== file.size) return this.makeWriter()

    if (req.offset + req.size > file.size && !this.lock()) return

    if (req.offset > this.writer.length) {
      if (req.offset > file.size) return this.truncate()
      return this.makeWriter()
    }

    this.writer.seek(req.offset)
    this.writer.write(new Blob([req.data], TYPE))
  }, err => req.callback(err))
}

function Mutex () {
  this.queued = null
}

Mutex.prototype.release = function () {
  const queued = this.queued
  this.queued = null
  for (let i = 0; i < queued.length; i++) {
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

function ReadRequest (pool, entry, mutex) {
  this.pool = pool
  this.entry = entry
  this.mutex = mutex
  this.reader = new FileReader()
  this.req = null
  this.retry = true
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
  this.entry.file(file => {
    const end = req.offset + req.size
    this.req = req
    if (end > file.size) return this.onread(new Error('Could not satisfy length'), null)
    this.reader.readAsArrayBuffer(file.slice(req.offset, end))
  }, err => req.callback(err))
}

function DeleteRequest (pool, entry, mutex) {
  this.pool = pool
  this.entry = entry
  this.mutex = mutex
  this.writer = null
  this.req = null
  this.locked = false
}

DeleteRequest.prototype.makeWriter = function () {
  const self = this
  this.entry.createWriter(function (writer) {
    self.writer = writer

    writer.onwriteend = function () {
      self.onwrite(null)
    }

    writer.onerror = function (err) {
      self.onwrite(err)
    }

    self.run(self.req)
  })
}

DeleteRequest.prototype.onwrite = function (err) {
  const req = this.req
  this.req = null

  if (this.locked) {
    this.locked = false
    this.mutex.release()
  }

  this.pool.push(this)
  req.callback(err, null)
}

DeleteRequest.prototype.lock = function () {
  if (this.locked) return true
  this.locked = this.mutex.lock(this)
  return this.locked
}

DeleteRequest.prototype.run = function (req) {
  this.entry.file(file => {
    this.req = req

    if (req.offset + req.size < file.size) return req.callback(null)

    if (!this.writer) return this.makeWriter()
    if (!this.lock()) return

    this.writer.truncate(req.offset)
  }, err => req.callback(err))
}
