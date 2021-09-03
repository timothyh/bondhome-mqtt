'use strict'

const util = require('util')

const {
    EventEmitter
} = require('events')

const bb = require('./bondbridge')

class BondHome {
    static debug = false
    static verbose = false

    static bpupBridgePort = 30007
    static bpupListenPort = undefined
    static _slugSeparator
    static _bpupListener
    static _bridges = {}
    static _events = new EventEmitter()

    static setSeparator(sep) {
        BondHome._slugSeparator = sep
    }

    static toSlug(value) {
        // Ignore any string between ()
        return BondHome._slugSeparator ? value.toLowerCase().replace(/\([^)]+\)/g, ' ').replace(/[^\w\d]+/g, ' ').trim().replace(/ /g, BondHome._slugSeparator) : value.toLowerCase().replace(/[\/ ]+/g, ' ').trim()
    }

    static discover(timeout = 10000) {
        const mdns = require('mdns-js')
        var emitter = new EventEmitter()

        mdns.excludeInterface('0.0.0.0')

        var mdns_browser = mdns.createBrowser(mdns.tcp('bond'))

        mdns_browser.on('ready', function() {
            mdns_browser.discover()
        })

        mdns_browser.on('update', function(data) {
            var id = data.host.replace('.local', '').toUpperCase()

            var bridge = BondHome._bridges[id]
            if (bridge) {
                if (bridge.ip_address) {
                    if (BondHome.verbose && bridge.ip_address !== data.addresses[0]) console.log('Duplicate IP for bridge: %s (%s)', id, data.addresses[0])
                } else {
                    if (BondHome.verbose) console.log('discovered known bridge: %s (%s)', id, data.addresses[0])
                    bridge.ip_address = data.addresses[0]
                    bridge.refresh()
                }
            } else {
                if (BondHome.verbose) console.log('discovered new bridge: %s (%s)', id, data.addresses[0])
                bridge = new bb.BondBridge(id, data.addresses[0])
            }
        })

        //stop after timeout
        setTimeout(function() {
            mdns_browser.stop()
        }, timeout)

        return emitter
    }

    static events() {
        // if (!BondHome._events) BondHome._events = new EventEmitter()

        return BondHome._events
    }

    static bpupListen() {
        const dgram = require('dgram')

        var listener = dgram.createSocket('udp4')

        listener.bind(BondHome.bpupListenPort)

        listener.on('error', (err) => {
            console.warn("server error: \n%s", err.stack)
            listener.close()
        })

        listener.on('message', (msg, rinfo) => {

            if (rinfo.port != BondHome.bpupBridgePort) {
                console.warn("packet from unexpected port: %s:%s", rinfo.address, rinfo.port)
                return
            }
            var resp
            try {
                resp = JSON.parse(msg)
            } catch {
                console.log("Badly formed message: %s", msg)
            }
            if (!resp.t) return

            var bridge_id = resp.B
            if (!bridge_id) return

            bridge_id = bridge_id.toUpperCase()
            var bridge = BondHome._bridges[bridge_id]
            if (!bridge) {
                new bb.BondBridge(bridge_id, rinfo.address, undefined)
                return
            }

            if (rinfo.address !== bridge.ip_address) {
                console.warn("packet from unexpected source: %s", rinfo.address, rinfo.port)
                return
            }

            bridge.bpup_activity = Date.now()

            var dev_id = resp.t.replace(/devices\/(\w\w*)\/state/, '$1')
            var device = bridge.devices[dev_id]
            if (!device) {
                console.warn("status from unexpected device: %s", dev_id)
                bridge.refresh()
                return
            }

            if (BondHome.debug) console.log("bridge: %s device: %s state: %s", bridge_id, device.name, resp.b)

            if (!resp.b) return

            device._setState(resp.b)
        })
        BondHome._bpupListener = listener
    }

    static enableBpup(ip) {
        BondHome._bpupListener.send("\n", 0, 1, BondHome.bpupBridgePort, ip)
    }

    static findBridge(id) {
        return BondHome._bridges[id]
    }
}

module.exports.debug = BondHome.debug
module.exports.verbose = BondHome.verbose
module.exports.BondHome = BondHome
module.exports.toSlug = BondHome.toSlug
module.exports.enableBpup = BondHome.enableBpup
module.exports.findBridge = BondHome.findBridge
module.exports._bridges = BondHome._bridges
module.exports._events = BondHome._events