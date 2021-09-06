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
        "SetBrightness",
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

var publishState = false
var publishJson = false

var hassEnabled = false
var hassStatusTopic
var hassModules = './homeassistant/'
var hassMqttOptions = {}

bond.BondHome.verbose = verbose
bond.BondHome.debug = debug

var configChanged = false

bond.BondHome.bpupListenPort = (config.bpup_port !== undefined) ? config.bpup_port : 30008

// Legacy
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

switch (config.event_stream) {
    case undefined:
    case 'state':
        publishState = true
        break
    case 'json':
        publishJson = true
        break
    case 'full':
        publishState = true
        publishJson = true
        break
}

if (config.homeassistant) {
    hassEnabled = mh.isTrue(config.homeassistant.discovery_enable)
    if (hassEnabled) {
        hassMqttOptions.retain = mh.isTrue(config.homeassistant.retain)
        if (config.homeassistant.status_topic) hassStatusTopic = config.homeassistant.status_topic
        if (config.homeassistant.modules) hassModules = config.homeassistant.modules + '/'
    }
}

var mqttActivity = Date.now()

var mqttConf = {
    ...config.mqtt_conf
}
if (!mqttConf.topic_prefix) mqttConf.topic_prefix = 'bondhome'
if (!mqttConf.host) mqttConf.host = 'localhost'
if (!mqttConf.port) mqttConf.port = 1883
if (!mqttConf.protocol) mqttConf.protocol = 'mqtt'

if (mqttConf.cafile) mqttConf.cacertificate = [fs.readFileSync(mqttConf.cafile)]

// Transition inactivity parameters to MQTT attributes
if (mqttConf.keepalive_interval) keepaliveInterval = mqttConf.keepalive_interval * 1000
if (mqttConf.inactivity_timeout) inactivityTimeout = mqttConf.inactivity_timeout * 1000

var mqttClient = mqtt.connect({
    ca: mqttConf.cacertificate,
    host: mqttConf.host,
    port: mqttConf.port,
    username: mqttConf.username,
    password: mqttConf.password,
    protocol: mqttConf.protocol,
    keepalive: mqttConf.keepalive,
    will: {
        topic: mqttConf.topic_prefix + '/' + 'system/state',
        payload: 'stop'
    }
})

mqttClient.on('connect', function() {
    console.log("connected to MQTT broker: %s:%s", mqttConf.host, mqttConf.port)
    mqttClient.subscribe(mqttConf.topic_prefix + '/+/set/#')
    mqttClient.subscribe(mqttConf.topic_prefix + '/+/list/#')
    mqttClient.subscribe(mqttConf.topic_prefix + '/list/devices')
    mqttClient.subscribe(mqttConf.ping_topic)
    if (hassStatusTopic) mqttClient.subscribe(hassStatusTopic)
})

mqttClient.on('message', function(topic, message) {
    mqttActivity = Date.now()

    if (topic === mqttConf.ping_topic) return

    message = message.toString()

    if (verbose) console.log("topic: %s message: %s", topic, message)

    if (topic === hassStatusTopic) {
        if (message === config.homeassistant.startup_payload) setTimeout(hassPublishAll, 30000)
        return
    }

    var devSlug = stateTopics[topic]

    if (devSlug) {

        if (verbose) console.log("topic: %s device: %s state: %s", topic, devSlug, message)

        device = devices[devSlug]._device

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
        devices[devSlug]._changedPower = true
        configChanged = true

        return
    }

    // home/bondhome/device_slug/set/what/extra
    // home/bondhome/device_slug/list/what/extra
    //                    0       1   2    3
    var tmp = topic.replace(mqttConf.topic_prefix + '/', '').toLowerCase().split('/')

    if (tmp[0] === 'list' && tmp[1] === 'devices') {
        mqttClient.publish(mqttConf.topic_prefix + '/devices', JSON.stringify(Object.keys(devices).sort()))
        return
    }

    var devSlug = tmp[0]
    if (!devices[devSlug]) {
        console.warn("Unexpected topic: %s message: %s", topic, message)
        return
    }
    var device = devices[devSlug]._device

    if (tmp[1] === 'list') {
        switch (tmp[2]) {
            case 'commands':
                try {
                    mqttClient.publish(mqttConf.topic_prefix + '/' + devSlug + '/commands', JSON.stringify(Object.keys(device.commands).sort()))
                } catch {}
                break
            case 'actions':
                try {
                    mqttClient.publish(mqttConf.topic_prefix + '/' + devSlug + '/actions', JSON.stringify(device.actions))
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
                message = mh.isTrue(message) ? 'On' : 'Off'
                if (verbose) console.log('device: %s command: Light %s', devSlug, message)
                sendCommand(devSlug, 'Light ' + message)
                break
            case 'fan':
                message = mh.isTrue(message) ? 'On' : 'Off'
                if (verbose) console.log('device: %s command: Fan %s', devSlug, message)
                sendCommand(devSlug, 'Fan ' + message)
                break
            case 'speed':
                if (devices[devSlug].max_speed >= 1) {
                    var speed = -1
                    switch (message.toLowerCase()) {
                        case 'high':
                            speed = devices[devSlug]._highSpeed
                            break
                        case 'medium':
                            speed = devices[devSlug]._mediumSpeed
                            break
                        case 'low':
                            speed = devices[devSlug]._lowSpeed
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
                    } else if (speed > 0 && speed <= devices[devSlug].max_speed) {
                        sendCommand(devSlug, 'Speed ' + speed)
                    } else {
                        console.warn('device: %s command: Speed %s - invalid speed', devSlug, speed)
                    }
                }
                break
            case 'percentage':
                if (devices[devSlug].max_speed >= 1) {
                    var max_speed = devices[devSlug].max_speed
                    var speed = -1
                    try {
                        speed = parseInt(message)
                        speed = Math.floor(0.5 + (max_speed * (speed / 100.0)))
                    } catch {}
                    if (speed == 0) {
                        sendCommand(devSlug, 'Fan Off')
                    } else if (speed > 0 && speed <= max_speed) {
                        sendCommand(devSlug, 'Speed ' + speed)
                    } else {
                        console.warn('device: %s command: Speed %s - invalid speed', devSlug, message)
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

    if (!(devices[devSlug].power_state || devices[devSlug]._changedPower)) return
    devices[devSlug]._changedPower = false

    var changed = false

    if (device.type === 'CF' && !devices[devSlug].has_light) {
        delete newState.light
        delete newState.brightness
    }

    for (const name in newState) {
        if (newState[name] === devices[devSlug].state[name]) continue
        if (debug) console.log("%s/%s = %s", devSlug, name, newState[name])

        devices[devSlug].state[name] = newState[name]
        changed = true
        configChanged = true

        if (publishState) {
            if (newState[name] === undefined || newState[name] === null) continue

            var msg = newState[name].toString()
            mqttClient.publish(mqttConf.topic_prefix + '/' + devSlug + '/' + name, msg)
            if (name === 'speed') {
                msg = Math.floor(0.5 + (newState.speed * 100.0 / devices[devSlug].max_speed)).toString()
                mqttClient.publish(mqttConf.topic_prefix + '/' + devSlug + '/percentage', msg)
            }
        }
    }

    if (changed && publishJson) mqttClient.publish(mqttConf.topic_prefix + '/' + devSlug + '/event', JSON.stringify(devices[devSlug].state))
})

bond.events().on('warn', function(device, msg) {
    console.warn(msg)
}).on('error', function(device, msg) {
    console.error(msg)
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
            action = devices[devSlug]._device.commands[cmdSlug][0]
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

    devices[devSlug]._device.sendCommand(command, repeat, interval)
}

function newDevice(device) {
    var devSlug = device.name.toSlug()

    console.log("discovered device: bridge: %s device: %s slug: %s type: %s template: %s", device.bridge.bridge_id, device.name, devSlug, device.type, device.template)

    if (!devices[devSlug]) devices[devSlug] = {}

    devices[devSlug]._device = device
    devices[devSlug].power_state = true

    if (!devices[devSlug].state) devices[devSlug].state = {}

    var max_speed
    if (device.max_speed >= 1) {
        max_speed = Math.floor(devices[devSlug].max_speed)
        max_speed = (max_speed >= 1 && max_speed < device.max_speed) ? max_speed : device.max_speed
        devices[devSlug]._lowSpeed = Math.floor(0.5 + ((max_speed * 1.0) / 3.0))
        devices[devSlug]._mediumSpeed = Math.floor(0.5 + ((max_speed * 2.0) / 3.0))
        devices[devSlug]._highSpeed = max_speed
        devices[devSlug].max_speed = max_speed
    }

    setTimeout(function() {
        if (verbose) {
            console.log("device: %s actions: %s", devSlug, device.actions.sort().join(' '))
            console.log("device: %s commands: %s", devSlug, Object.keys(device.commands).sort().join(' '))
	    if (device.max_speed >= 1) console.log("device: %s max_speed: %s", devSlug, max_speed)
        }
        hassPublish(devSlug)
    }, 5000)

    configChanged = true
}

function hassPublishAll() {
    if (!hassEnabled) return

    console.log("Publishing homeassistant configuration")
    for (const devSlug in devices) {
        hassPublish(devSlug)
    }
}

function hassPublish(devSlug) {
    if (!hassEnabled) return

    var device = devices[devSlug]._device
    var hc
    var mods = []
    var base
    if (devices[devSlug].homeassistant_module) {
        var m = devices[devSlug].homeassistant_module
        mods.push(m.match(/\//) ? m : hassModules + m)
    }
    if (devices[devSlug].model) mods.push(hassModules + 'model-' + devices[devSlug].model.toSlug('-'))
    if (device.template) mods.push(hassModules + 'template-' + device.template.toSlug('-'))
    if (device.type) mods.push(hassModules + 'type-' + device.type.toLowerCase())
    for (const mod of mods) {
        try {
            if (verbose) console.log("%s: trying to load module: %s", devSlug, mod)
            hc = require(mod)
            if (verbose) console.log("%s: loaded module: %s", devSlug, mod)
        } catch (err) {
            if (err.code !== 'MODULE_NOT_FOUND') throw (err)
        }
        if (hc) break
    }
    if (hc) {
        var res = hc.hassConfig(devSlug, mqttConf.topic_prefix, devices[devSlug])
        for (const topic in res) {
            mqttClient.publish(config.homeassistant.topic_prefix + '/' + topic + '/config', JSON.stringify(res[topic]), hassMqttOptions)
        }

        var state = devices[devSlug].state
        if (state) {
            for (const name in state) {
                var msg = state[name].toString()
                mqttClient.publish(mqttConf.topic_prefix + '/' + devSlug + '/' + name, msg)
                if (name === 'speed') {
                    msg = Math.floor(0.5 + (state.speed * 100.0 / devices[devSlug].max_speed)).toString()
                    mqttClient.publish(mqttConf.topic_prefix + '/' + devSlug + '/percentage', msg)
                }
            }
        }
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
    } catch {
        console.warn("Unable to parse cache file - ", config.config_cache)
    }

    return
}

function replacer(key, value) {
    return (key.match(/^_/)) ? undefined : value
}

function writeCache() {
    if (config.config_cache) {
        var jsondata = "{\n" +
            '"config": ' + JSON.stringify(config, null, 2) + ",\n" +
            '"bridges": ' + JSON.stringify(bridges, replacer, 2) + ",\n" +
            '"devices\": ' + JSON.stringify(devices, replacer, 2) + "\n" +
            "}\n"
        fs.writeFile(config.config_cache, jsondata, (err) => {
            if (err) throw err
        })
    }
}

bond.events().on('bridge', function(bridge) {
    var id = bridge.bridge_id
    console.log('discovered bridge: %s', id)
    if (!bridges[id]) bridges[id] = {}
    bridges[id]._bridge = bridge
    bridges[id].local_token = bridge.token
    bridges[id].ip_address = bridge.ip_address
    bridges[id].debug = mh.isTrue(bridge.debug)
    bridge.removeAllListeners().on('device', newDevice)
    configChanged = true
})

readCache()

if (config.devices) {
    for (const dev in config.devices) {
        if (debug) console.log('device: %s', dev)

        var devSlug = dev.toSlug()
        if (!devices[devSlug]) devices[devSlug] = {}
        delete devices[devSlug].state_topic

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
        var brtmp = config.bridges[id]
        if (!bridges[id]) bridges[id] = {}
        for (const attr in brtmp) {
            bridges[id][attr] = brtmp[attr]
        }
    }
}

for (const id in bridges) {
    var brtmp = bridges[id]
    var bridge = new bond.BondBridge(id, brtmp.ip_address, brtmp.local_token, brtmp.debug)
    bridge.removeAllListeners().on('device', newDevice)
}

if (mh.isTrue(config.auto_discover) !== false) bond.discover()

if (config.no_repeat) {
    config.no_repeat.sort().forEach(function(cmd) {
        var cmdSlug = cmd.toSlug()
        noRepeat.push(cmdSlug)
    })
}

setInterval(function() {
    if (configChanged) writeCache()
    configChanged = false
}, 5000)

function exitNow() {
    if (configChanged) writeCache()
    configChanged = false
    process.exit(0)
}

process.on('SIGTERM', exitNow)
process.on('SIGINT', exitNow)

mqttClient.publish(mqttConf.topic_prefix + '/' + 'system/state', 'start')
