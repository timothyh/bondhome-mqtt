'use strict'

const util = require('util')
const fs = require('fs')
const mqtt = require('mqtt')

const mh = require('./my-helpers')
const bond = require('./bondhome')

var args = process.argv.slice(2);

var config = mh.readConfig(args[0] ? args[0] : 'config.json')

var bridges = {}

var devices = {}

var noRepeat = []

var stateTopics = {}

var separators = ['_', '-', '$', ':', ';', '!', '@', '#', '%', '^', '~']

var actions = {
    light: [
        "DecreaseBrightness",
        "IncreaseBrightness",
        "ToggleLight",
        "TurnLightOff",
        "TurnLightOn"
    ]
}

/* default inspection options */

//util.inspect.defaultOptions.maxArrayLength = null
//util.inspect.defaultOptions.depth = null

var verbose = mh.isTrue(config.verbose)
var debug = mh.isTrue(config.debug)

bond.BondHome.verbose = verbose
bond.BondHome.debug = debug

var configChanged = false

bond.BondHome.bpupListenPort = (config.bpup_port !== undefined) ? config.bpup_port : 30008

var keepaliveInterval = config.keepalive_interval ? config.keepalive_interval * 1000 : 60000
var inactivityTimeout = config.inactivity_timeout ? config.inactivity_timeout * 1000 : 90000

if (config.slug_separator) {
    if (!separators.includes(config.slug_separator)) {
        console.warn("Invalid slug separator: '%s'", config.slug_separator)
        process.exit(1)
    }
    bond.BondHome.setSeparator(config.slug_separator)
    mh.setSeparator(config.slug_separator)
}

var mqttActivity = Date.now()

var mqttConf = {
    ...config.mqtt_conf
}

if (mqttConf.cafile) mqttConf.cacertificate = [fs.readFileSync(mqttConf.cafile)]

var mqttClient = mqtt.connect({
    ca: mqttConf.cacertificate,
    host: mqttConf.host,
    port: mqttConf.port,
    username: mqttConf.username,
    password: mqttConf.password,
    protocol: mqttConf.protocol,
    keepalive: mqttConf.keepalive,
    will: {
        topic: mqttConf.topic + '/' + 'system/state',
        payload: 'stop'
    }
})

mqttClient.on('connect', function() {
    console.log("connected to MQTT broker: %s:%s", mqttConf.host, mqttConf.port)
    mqttClient.subscribe(mqttConf.topic + '/+/set/#')
    mqttClient.subscribe(mqttConf.topic + '/+/list/#')
    mqttClient.subscribe(mqttConf.topic + '/list/devices')
    mqttClient.subscribe(mqttConf.ping_topic)
})

mqttClient.on('message', function(topic, message) {
    mqttActivity = Date.now()

    if (topic === mqttConf.ping_topic) return

    message = message.toString()
    var devSlug = stateTopics[topic]

    if (devSlug) {

        if (verbose) console.log("topic: %s device: %s state: %s", topic, devSlug, message)

        device = devices[devSlug].device

        if (!device) {
            console.warn("Power state for unknown device: %s", devSlug)
            return
        }

        var powerState = mh.isTrue(message)
        if (powerState) {
            if (devices[devSlug].power_on_state === 'restore') {
                device.updateState(devices[devSlug].state)
            } else if (devices[devSlug].power_on_state) {
                device.updateState(devices[devSlug].power_on_state)
            }
        } else {
            if (devices[devSlug].power_off_state) {
                if (devices[devSlug].power_on_state !== 'restore') {
                    device.updateState(devices[devSlug].power_off_state)
                }
            }
        }
        devices[devSlug].power_state = powerState
        devices[devSlug].changed_power = true

        return
    }

    // home/bondhome/device_slug/set/what/extra
    // home/bondhome/device_slug/list/what/extra
    //                    0       1   2    3
    var tmp = topic.replace(mqttConf.topic + '/', '').toLowerCase().split('/')

    if (tmp[0] === 'list' && tmp[1] === 'devices') {
        mqttClient.publish(mqttConf.topic + '/devices', JSON.stringify(Object.keys(devices).sort()))
        return
    }

    var devSlug = tmp[0]
    if (!devices[devSlug]) {
        console.warn("Unexpected topic: %s message: %s", topic, message)
        return
    }
    var device = devices[devSlug].device

    if (tmp[1] === 'list') {
        switch (tmp[2]) {
            case 'commands':
                try {
                    mqttClient.publish(mqttConf.topic + '/' + devSlug + '/commands', JSON.stringify(Object.keys(device.commands).sort()))
                } catch {}
                break
            case 'actions':
                try {
                    mqttClient.publish(mqttConf.topic + '/' + devSlug + '/actions', JSON.stringify(device.actions))
                } catch {}
                break
        }
    } else if (tmp[1] === 'set') {
        if (!devices[devSlug].power_state) {
            if (verbose) console.log("Device powered off: %s", devSlug)
            return
        }
        switch (tmp[2]) {
            case 'command':
                if (verbose) console.log('device: %s command: %s', devSlug, message)
                sendCommand(devSlug, message)
                break
            case 'light':
                if (verbose) console.log('device: %s command: Light %s', devSlug, message)
                sendCommand(devSlug, 'Light ' + (mh.isTrue(message) ? 'On' : 'Off'))
                break
            case 'fan':
                if (verbose) console.log('device: %s command: Fan %s', devSlug, message)
                sendCommand(devSlug, 'Fan ' + (mh.isTrue(message) ? 'On' : 'Off'))
                break
            case 'speed':
                var max_speed = Math.floor(devices[devSlug].max_speed)
                max_speed = (max_speed >= 1 && max_speed < device.max_speed) ? max_speed : device.max_speed
                if (max_speed) {
                    var speed = -1
                    switch (message.toLowerCase()) {
                        case 'high':
                            speed = max_speed
                            break
                        case 'medium':
                            speed = Math.floor(0.5 + ((max_speed * 2.0) / 3.0))
                            break
                        case 'low':
                            speed = Math.floor(0.5 + ((max_speed * 1.0) / 3.0))
                            break
                        case 'off':
                            speed = 0
                            break
                        default:
                            try {
                                speed = parseInt(message)
                            } catch {}
                    }
                    if (verbose) console.log('device: %s command: Speed %s', devSlug, speed)
                    if (speed == 0) {
                        sendCommand(devSlug, 'Fan Off')
                    } else if (speed > 0 && speed <= max_speed) {
                        sendCommand(devSlug, 'Speed ' + speed)
                    } else {
                        console.warn('device: %s command: Speed %s - invalid speed', devSlug, speed)
                    }
                }
                break
            case 'action':
                var action = topic.replace(/^.*\//, '')
                if (device.actions.includes(action)) {
                    if (verbose) console.log('device: %s action: %s argument: %s', devSlug, action, message)
                    device.sendAction(action, message, 1)
                } else {
                    console.warn('device: %s action: %s argument: %s - unexpected action', devSlug, action, message)
                }
                break
        }
    }
})

bond.events().on('event', function(device, state) {
    var newState = {
        ...state
    }
    var devSlug = device.name.toSlug()

    if (verbose) console.log("device: %s state: %s", devSlug, newState)

    if (!(devices[devSlug].power_state || devices[devSlug].changed_power)) return
    devices[devSlug].changed_power = false

    var changed = false

    for (const name in newState) {
        if (newState[name] === devices[devSlug].state[name]) continue
        if (debug) console.log("%s/%s = %s", devSlug, name, newState[name])

        devices[devSlug].state[name] = newState[name]
        changed = true

        if (newState[name] === undefined || newState[name] === null) continue

        mqttClient.publish(mqttConf.topic + '/' + devSlug + '/' + name, newState[name].toString())
    }

    if (changed && config.event_stream === 'full') {
        mqttClient.publish(mqttConf.topic + '/' + devSlug + '/event', JSON.stringify(devices[devSlug].state))
    }
})

if (keepaliveInterval) {
    setInterval(function() {
        mqttClient.publish(mqttConf.ping_topic, JSON.stringify({
            timestamp: new Date().toISOString()
        }))
    }, keepaliveInterval)
}

if (inactivityTimeout) {
    setInterval(function() {
        var mqttLast = (Date.now() - mqttActivity)
        if (mqttLast >= inactivityTimeout) {
            console.warn("Exit due to MQTT inactivity")
            process.exit(10)
        }
    }, 10000)
}

function sendCommand(devSlug, command) {
    var cmdSlug = command.toSlug()

    if (!devices[devSlug].has_light) {
        var action
        try {
            action = devices[devSlug].device.commands[cmdSlug][0]
        } catch {}
        if (actions.light.includes(action)) {
            if (verbose) console.log('device: %s command: %s - no light in device', devSlug, cmdSlug)
            return
        }
    }

    var max_speed = Math.floor(devices[devSlug].max_speed)
    if (max_speed >= 1 && cmdSlug > ('Speed ' + max_speed).toSlug()) {
        if (verbose) console.log('device: %s command: %s - invalid speed', devSlug, cmdSlug)
        return
    }
    var repeat = devices[devSlug].repeat
    var interval = devices[devSlug].repeat_interval

    if (repeat > 1 && noRepeat.includes(cmdSlug)) repeat = 1

    devices[devSlug].device.sendCommand(command, repeat, interval)
}

function newDevice(device) {
    var devSlug = device.name.toSlug()

    console.log("discovered device: bridge: %s device: %s slug: %s", device.bridge.bridge_id, device.name, devSlug)

    if (!devices[devSlug]) devices[devSlug] = {}

    devices[devSlug].device = device
    devices[devSlug].power_state = true

    if (!devices[devSlug].state) devices[devSlug].state = {}

    if (verbose) {
        console.log("device: %s actions: %s", devSlug, device.actions.sort().join(' '))
        var cmds = device.commands
        // Commands are discovered asynchronously so wait before printing list
        setTimeout(function() {
            console.log("device: %s commands: %s", devSlug, Object.keys(cmds).sort().join(' '))
        }, 5000)
    }
}

function readCache() {
    if (!config.config_cache) return

    try {
        var rawdata = fs.readFileSync(config.config_cache)
        var tmp = JSON.parse(rawdata)

        if (tmp.bridges) bridges = tmp.bridges
        if (tmp.devices) devices = tmp.devices
        if (verbose) {
            console.log("bridges in cache - ", Object.keys(bridges).sort().join(' '))
            console.log("devices in cache - ", Object.keys(devices).sort().join(' '))
        }
        for (const devSlug in devices) {
            device_ids[devices[devSlug].device_id] = devSlug
        }
    } catch {
        console.warn("Unable to parse cache file - ", config.config_cache)
    }

    return
}

function writeCache() {
    if (config.config_cache) {
        var jsondata = "{\n" +
            '"config": ' + JSON.stringify(config, null, 2) + ",\n" +
            '"bridges": ' + JSON.stringify(bridges, null, 2) + ",\n" +
            '"devices\": ' + JSON.stringify(devices, null, 2) + "\n" +
            "}\n"
        fs.writeFile(config.config_cache, jsondata, (err) => {
            if (err) throw err
        })
    }
}

// readCache()

if (config.devices) {
    for (const dev in config.devices) {
        if (debug) console.log('device: %s', dev)

        var devSlug = dev.toSlug()
        if (!devices[devSlug]) devices[devSlug] = {}
        devices[devSlug]._config = dev

        for (const name in config.devices[dev]) {
            devices[devSlug][name] = config.devices[dev][name]
        }

        if (devices[devSlug].has_light === undefined) devices[devSlug].has_light = true

        if (devices[devSlug].state_topic) {
            stateTopics[devices[devSlug].state_topic] = devSlug
            mqttClient.subscribe(devices[devSlug].state_topic)
            if (verbose) console.log("%s: subscribed to: %s", devSlug, devices[devSlug].state_topic)
        }
        configChanged = true
    }
}

if (config.bridges) {
    for (const id in config.bridges) {
        var bridge = new bond.BondBridge(id, config.bridges[id].ip_address, config.bridges[id].local_token)
        bridges[id] = bridge
        bridge.removeAllListeners().on('device', newDevice)
    }
}

if (mh.isTrue(config.auto_discover) !== false) {
    bond.discover().on('bridge', function(bridge) {
        console.log('discovered bridge: %s', bridge.bridge_id)
        bridges[bridge.bridge_id] = bridge
        bridge.removeAllListeners().on('device', newDevice)
    })
}

if (config.no_repeat) {
    config.no_repeat.sort().forEach(function(cmd) {
        var cmdSlug = cmd.toSlug()
        noRepeat.push(cmdSlug)
    })
}

setInterval(function() {
    // if (configChanged) writeCache()
    configChanged = false
}, 5000)

mqttClient.publish(mqttConf.topic + '/' + 'system/state', 'start')
