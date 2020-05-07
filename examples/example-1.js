'use strict'

const util = require('util')
const fs = require('fs')

const mh = require('./my-helpers')
const bond = require('./bondhome')

var args = process.argv.slice(2);

var config = {}
if (args[0]) config = mh.readConfig(args[0])

bond.BondHome.verbose = true

bond.BondHome.bpupListenPort = undefined

bond.BondHome.setSeparator('_')

var warning = `
WARNING

In 10 seconds, this sample program will turn on the light for all devices discovered.

If that behavior is not wanted, stop NOW!!
`
console.log(warning)

bond.events().on('event', function(device, state) {
    console.log("%s\nstate: %s", device.name, state)
})

function newDevice(device) {
    console.log("discovered: bridge: %s device: %s", device.bridge.bridge_id, device.name)

    console.log("%s actions:\n- %s", device.name, device.actions.sort().join("\n- "))
    var cmds = device.commands

    // Commands are discovered asynchronously so wait before printing list
    setTimeout(function() {
        console.log("%s commands:\n- %s", device.name, Object.keys(cmds).sort().join("\n- "))
    }, 5000)

    // And turn light on
    setTimeout(function() {
        device.sendCommand('Light On')
    }, 10000)
}

if (config.bridges) {
    for (const id in config.bridges) {
        var bridge = new bond.BondBridge(id, config.bridges[id].ip_address, config.bridges[id].local_token)
        bridge.removeAllListeners().on('device', newDevice)
    }
}

bond.discover().on('bridge', function(bridge) {
    console.log('discovered bridge: %s', bridge.bridge_id)
    bridge.removeAllListeners().on('device', newDevice)
})

setTimeout(function() {
    console.log(`

Now use Bond app to control devices

`)
}, 15000)