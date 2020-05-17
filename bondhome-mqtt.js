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

var publishState = false
var publishJson = false

var hassEnabled = false
var hassStatusTopic
var hassMqttOptions = {}

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

if (config.homeassistant) hassEnabled = mh.isTrue(config.homeassistant.discovery_enable)
if (hassEnabled) hassMqttOptions.retain = mh.isTrue(config.homeassistant.retain)
if (hassEnabled && config.homeassistant.status_topic) hassStatusTopic = config.homeassistant.status_topic

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
                device.updateState(devices[devSlug]._state)
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
        devices[devSlug]._powerState = powerState
        devices[devSlug]._changedPower = true

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
        if (!devices[devSlug]._powerState) {
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

    if (!(devices[devSlug]._powerState || devices[devSlug]._changedPower)) return
    devices[devSlug]._changedPower = false

    var changed = false

    for (const name in newState) {
        if (newState[name] === devices[devSlug]._state[name]) continue
        if (debug) console.log("%s/%s = %s", devSlug, name, newState[name])

        devices[devSlug]._state[name] = newState[name]
        changed = true
    }

    if (changed) {
        if (publishState) {
            for (const name in newState) {
                if (newState[name] === undefined || newState[name] === null) continue
                var msg = newState[name].toString()
                mqttClient.publish(mqttConf.topic_prefix + '/' + devSlug + '/' + name, msg)
            }
        }
        if (publishJson) mqttClient.publish(mqttConf.topic_prefix + '/' + devSlug + '/event', JSON.stringify(devices[devSlug]._state))
    }
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
    devices[devSlug]._powerState = true

    if (!devices[devSlug]._state) devices[devSlug]._state = {}

    if (verbose) console.log("device: %s actions: %s", devSlug, device.actions.sort().join(' '))

    var max_speed
    if (device.max_speed >= 1) {
        max_speed = Math.floor(devices[devSlug].max_speed)
        max_speed = (max_speed >= 1 && max_speed < device.max_speed) ? max_speed : device.max_speed
        devices[devSlug]._lowSpeed = Math.floor(0.5 + ((max_speed * 1.0) / 3.0))
        devices[devSlug]._mediumSpeed = Math.floor(0.5 + ((max_speed * 2.0) / 3.0))
        devices[devSlug]._highSpeed = max_speed
        devices[devSlug].max_speed = max_speed
    }

    if (hassEnabled) hassPublish(devSlug)

    if (verbose) console.log("device: %s max_speed: %s commands: %s", devSlug, max_speed, Object.keys(device.commands).sort().join(' '))
}

function hassPublishAll() {
    console.log("Publishing homeassistant configuration")
    for (const devSlug in devices) {
        hassPublish(devSlug)
    }
}

function hassPublish(devSlug) {
    var device = devices[devSlug]._device
    switch (device.type) {
        case 'CF':
            var id = 'bond-' + device.bridge.bridge_id.toLowerCase() + '-' + device.device_id.toLowerCase()
            var name = devices[devSlug].fan_name ? devices[devSlug].fan_name : device.name
            var attr = {
                'command_topic': mqttConf.topic_prefix + '/' + devSlug + '/set/fan',
                'device': {
                    'identifiers': id + '-fan',
                    'manufacturer': 'BondHome',
                    'model': ((device.template && device.template.length > 2) ? device.template : 'undefined'),
                    'name': device.name,
                    'via_device': 'bond-' + device.bridge.bridge_id.toUpperCase()
                },
                'name': name,
                'payload_off': '0',
                'payload_on': '1',
                'state_topic': mqttConf.topic_prefix + '/' + devSlug + '/power',
                'unique_id': id + '-fan'
            }
            if (device.max_speed >= 1) {
                attr.payload_low_speed = devices[devSlug]._lowSpeed
                attr.payload_medium_speed = devices[devSlug]._mediumSpeed
                attr.payload_high_speed = devices[devSlug]._highSpeed
                attr.speeds = ['off', 'low', 'medium', 'high']
                attr.speed_command_topic = mqttConf.topic_prefix + '/' + devSlug + '/set/speed'
                attr.speed_state_topic = mqttConf.topic_prefix + '/' + devSlug + '/speed'
            }
            mqttClient.publish(config.homeassistant.topic_prefix + '/fan/' + devSlug + '/config', JSON.stringify(attr), hassMqttOptions)
            if (devices[devSlug].has_light) {
                var name = devices[devSlug].light_name ? devices[devSlug].light_name : device.name + ' Light'
                var attr = {
                    'command_topic': mqttConf.topic_prefix + '/' + devSlug + '/set/light',
                    'device': {
                        'identifiers': id + '-lit',
                        'manufacturer': 'BondHome',
                        'model': ((device.template && device.template.length > 2) ? device.template : 'undefined'),
                        'name': device.name + '(Light)',
                        'via_device': id + '-fan'
                    },
                    'name': name,
                    'payload_off': '0',
                    'payload_on': '1',
                    'state_topic': mqttConf.topic_prefix + '/' + devSlug + '/light',
                    'unique_id': id + '-lit'
                }
                mqttClient.publish(config.homeassistant.topic_prefix + '/light/' + devSlug + '/config', JSON.stringify(attr), hassMqttOptions)
            }
            break
        case 'FP':
            break
        case 'MS':
            break
        case 'GX':
            break
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

mqttClient.publish(mqttConf.topic_prefix + '/' + 'system/state', 'start')