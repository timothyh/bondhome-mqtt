#!/usr/bin/node

/*
 * Utility to discover Bond Home devices on local network
 *
 * Usage: node discover.js [options ....] [config_file]
 *
 * Options are:
 *    --list - List discovered devices (default)
 *    --config - Generate/update bondhome-mqtt configuration file
 *    --wait=99 - How long to wait before exiting (in seconds) - Default 15
 *    --verbose - Include commands and actions supported by discovered devices
 *    --debug
 *
 * config_file is optional and defines config file to use - defaults to ./config.json
 * if provided, config_file must be a properly formatted JSON file
 * If required, config_file may be used to inject local tokens into the configuration
 */
'use strict'

const util = require('util')
const fs = require('fs')

const mh = require('./my-helpers')
const bond = require('./bondhome')

var config = {
    bridges: {}
}

var op = 'list'
var config_file = './config.json'

var verbose = false
var debug = false
var wait = 15

bond.BondHome.verbose = false

for (const arg of process.argv.slice(2)) {
    var tmp = arg.split('=')
    switch (tmp[0]) {
        case '--wait':
            wait = tmp[1]
            break
        case '--config':
            op = 'config'
            break
        case '--list':
            op = 'list'
            break
        case '-v':
        case '--verbose':
            verbose = true
            break
        case '-d':
        case '--debug':
            debug = true
            bond.BondHome.debug = true
            break
        case '--':
            break
        default:
            config_file = arg
            break
    }
}

if (config_file.length) {
try {
    if (!config_file.match(/\//)) config_file = './' + config_file
    config = require(config_file)
} catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw (err)
}
}

bond.BondHome.bpupListenPort = undefined

bond.BondHome.setSeparator('_')

bond.events().on('event', function(device, state) {
    if (verbose) console.log("device: %s state: %s", device.name, state)
})

function newDevice(device) {
    console.log("discovered device: bridge: %s device: %s", device.bridge.bridge_id, device.name)

    if (verbose) {
        console.log("%s actions:\n- %s", device.name, device.actions.sort().join("\n- "))
        console.log("%s commands:\n- %s", device.name, Object.keys(device.commands).sort().join("\n- "))
    }
}

if (config.bridges) {
    for (const id in config.bridges) {
        var bridge = new bond.BondBridge(id, config.bridges[id].ip_address, config.bridges[id].local_token)
        bridge.removeAllListeners().on('device', newDevice)
    }
}

bond.discover().on('bridge', function(bridge) {
    console.log('discovered bridge: %s', bridge.bridge_id)
    var tmp = {}
    tmp.local_token = bridge.token
    tmp.ip_address = bridge.ip_address
    config.bridges[bridge.bridge_id] = tmp
    bridge.removeAllListeners().on('device', newDevice)
})

function exitNow() {
    if (op === 'config') {
	config.verbose = true
        console.log('Sample configuration file follows')
        console.log('--------------------------------------------------------------')
        console.log(JSON.stringify(config, null, 2))
    } else {
        for (const id in config.bridges) {
            console.log("bridge: %s local_token: %s ip_address: %s", id, config.bridges[id].local_token, config.bridges[id].ip_address)
        }
    }
    process.exit(0)
}

setTimeout(exitNow, wait * 1000)

process.on('SIGINT', exitNow)
