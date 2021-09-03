'use strict'

const util = require('util')
const restClient = require('node-rest-client').Client
var client = new restClient()

const {
    EventEmitter
} = require('events')

const bh = require('./bondhome')
const bd = require('./bonddevice')

class BondBridge extends EventEmitter {
    constructor(id, ip = undefined, token = undefined, debug = false) {
        super()
        if (bh.BondHome.debug || debug) console.log("Bridge %s: ip: %s debug: %s", id, ip, debug)
        this.bridge_id = id.toUpperCase()
        if (bh._bridges[this.bridge_id]) {
            throw new Error('bridge: ' + id + ' already instantiated - Destroy old instance')
        }
        bh._bridges[this.bridge_id] = this

        if (!bh.BondHome._bpupListener) bh.BondHome.bpupListen()

        this.debug = debug
        this.token = token
        this._queue = []
        this.devices = {}
        this.bpup_activity = Date.now()
        this._rejectUnauthorized = false
        this.protocol = 'http'

        if (ip) {
            this.ip_address = ip
            this._getToken()
        }
        var self = this
        this._bpupTimer = setInterval(function() {
            if (self.ip_address) bh.enableBpup(self.ip_address)
        }, 60000)
        this._keepAliveTimer = setInterval(function() {
            if (!self._queueTimer && self._queue) self._sendNext()
        }, 1000)
    }

    refresh() {
        this.checksum = undefined
        this._getToken()
    }

    destroy() {
        if (this._queueTimer) clearTimeout(this._queueTimer)
        if (this._bpupTimer) clearInterval(this._bpupTimer)
        if (this._keepAliveTimer) clearInterval(this._keepAliveTimer)

        for (const dev_id in this.devices) {
            this.devices[dev_id].destroy()
        }

        delete bh._bridges[this.bridge_id]

        return undefined
    }

    _getToken() {
        this._queueNext({
            method: 'GET',
            path: '/v2/token',
            callback: this._processToken.bind(this)
        })
    }

    _processToken(args, data) {
        if (bh.BondHome.debug || this.debug) console.log("this=%s\nargs=%s\ndata=%s\n", this, args, data)

        if (data.locked) {
            if (bh.BondHome.verbose) console.log("bridge: %s - locked - no token retrieved", this.bridge_id)
        } else if (this.token) {
            if (this.token !== data.token) console.warn("bridge: %s - Warning token has changed", this.bridge_id)

            this.token = data.token
            console.log("bridge: %s - token updated", args.bridge_id)
        } else {
            data = data.toString().replace(/^.*<body>(.*)<\/body>.*$/is, '$1').replace(/\s+/gs, ' ')
            console.warn("bridge: %s - unrecognized reply: %s", this.bridge_id, data)
        }

        if (this.token) {
            this._getBridge()
        } else {
            console.warn("bridge: %s - Warning no token - unable to continue", this.bridge_id)
        }
    }

    _getBridge() {
        this._queueNext({
            method: 'GET',
            path: '/v2/bridge',
            callback: this._processBridge.bind(this)
        })
    }

    _processBridge(args, data) {
        if (bh.BondHome.debug || this.debug) console.log("this=%s\nargs=%s\ndata=%s\n", this, args, data)

        this.name = data.name
        this.location = data.location

        if (this.checksum && this.checksum === data._) {
            if (bh.BondHome.verbose) console.log("bridge: %s - configuration not changed", this.bridge_id)
            for (const dev_id in this.devices) {
                this.devices[dev_id].state = {}
                this.devices[dev_id]._getState(dev_id)
            }
        } else {
            this.checksum = data._
            this._getDeviceList()
        }
        bh.enableBpup(this.ip_address)

        bh._events.emit('bridge', this)
    }

    _getDeviceList() {
        this._queueNext({
            method: 'GET',
            path: '/v2/devices',
            callback: this._processDeviceList.bind(this)
        })
    }

    _processDeviceList(args, data) {
        if (bh.BondHome.debug || this.debug) console.log("this=%s\nargs=%s\ndata=%s\n", this, args, data)
        for (const dev_id in this.devices) {
            this.devices[dev_id].destroy()
            delete this.devices[dev_id]
        }
        var self = this
        for (const dev_id in data) {
            if (dev_id === '_') continue
            this.devices[dev_id] = new bd.BondDevice(this, dev_id)
        }
    }

    /*************************************************************************/

    _queueNext(args) {
        this._queue.push(args)
        if (this._queueTimer) return
        this._queueTimer = setTimeout(this._sendNext.bind(this), 0)
    }

    _sendNext() {
        this._queueTimer = undefined

        var args = this._queue.shift()
        if (!args) return

        if (!this.ip_address) {
            console.warn("bridge: %s - No IP address", this.bridge_id)
            return
        }
        var http_args = {
            headers: {
                "Content-Type": "application/json"
            },
            rejectUnauthorized: this._rejectUnauthorized
        }

        if (this.token) http_args.headers['BOND-Token'] = this.token

        var req
        var self = this
        switch (args.method) {
            // Placeholder - Used to mark place in queue - No interaction with device
            case 'NOOP':
                req = new EventEmitter()
                self._queueTimer = setTimeout(self._sendNext.bind(self), 10)
                setImmediate(args.callback, args)
                break
            case 'GET':
                req = client.get(this.protocol + '://' + self.ip_address + args.path, http_args, function(data, response) {
                    self.alive = true
                    self.activity = Date.now()
                    self._queueTimer = setTimeout(self._sendNext.bind(self), 50)
                    args.callback(args, data)
                })
                break
            case 'PATCH':
                if (args.data) http_args.data = args.data
                req = client.patch(this.protocol + '://' + self.ip_address + args.path, http_args, function(data, response) {
                    self.alive = true
                    self.activity = Date.now()
                    self._queueTimer = setTimeout(self._sendNext.bind(self), 50)
                    args.callback(args, data)
                })
                break
            case 'PUT':
                if (args.data) http_args.data = args.data
                req = client.put(this.protocol + '://' + self.ip_address + args.path, http_args, function(data, response) {
                    self.alive = true
                    self.activity = Date.now()
                    self._queueTimer = setTimeout(self._sendNext.bind(self), 200)
                    var repeat = (args.repeat ? (args.repeat - 1) : 0)
                    if (repeat) {
                        var interval = (args.interval ? (args.interval) : 500)
                        setTimeout(function() {
                            args.repeat = repeat
                            self._queueNext(args)
                        }, interval)
                    }
                    args.callback(args, data)
                })
                break
        }

        req.on('error', function(err) {
            console.warn('bridge: %s path: %s error: %s', self.bridge_id, args.path, err.message)
            if (bh.BondHome.debug || self.debug) console.log("bridge: %s full error: %s", self.bridge_id, err)
        })
    }
}

module.exports.BondBridge = BondBridge