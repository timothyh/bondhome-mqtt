'use strict'

const util = require('util')
const restClient = require('node-rest-client').Client
var client = new restClient()

//const { EventEmitter } = require('events')

const bh = require('./bondhome')

//class BondDevice extends EventEmitter {
class BondDevice {
    constructor(bridge, dev_id) {
        // console.log("New device: bridge: %s, device: %s", bridge.bridge_id, dev_id)
        // super()
        this.device_id = dev_id
        this.bridge = bridge
        this.state = {}
        this.commands = {}

        this._getDevice()
    }

    destroy() {}

    sendCommand(cmd, repeat = 1, interval = undefined) {
        var cmd_slug = bh.toSlug(cmd)

        var action
        var arg
        try {
            action = this.commands[cmd_slug][0]
            arg = this.commands[cmd_slug][1]
        } catch {}

        if (!action) {
            console.warn("Unexpected command: device: %s command: %s", this.name, cmd_slug)
            return
        }

        if (bh.debug) console.log("send_action(%s, %s, %s, %s, %s)", this.bridge.bridge_id, this.name, action, arg, repeat)

        this.sendAction(action, arg, repeat, interval)
    }

    sendAction(action, arg, repeat = 1, interval = undefined) {
        var data = JSON.stringify(arg ? {
            argument: arg
        } : {})

        this.bridge._queueNext({
            method: 'PUT',
            path: '/v2/devices/' + this.device_id + '/actions/' + action,
            data: data,
	    interval: interval,
            repeat: repeat,
            callback: this._processResult.bind(this)
        })
    }

    // Update local state - Doesn't interact with bridge
    _setState(state) {
        var new_state = {
            ...state
        }
	delete new_state._

        var changed = false

        for (const name in new_state) {
            if (new_state[name] === this.state[name]) continue
            if (bh.debug) console.log("%s/%s = %s", this.name, name, new_state[name])
            this.state[name] = new_state[name]
            changed = true
        }
	if (changed) bh._events.emit('event',this,new_state)
    }

    _getDevice() {
        this.bridge._queueNext({
            method: 'GET',
            path: '/v2/devices/' + this.device_id,
            callback: this._processDevice.bind(this)
        })
    }

    _processDevice(args, data) {
        if (bh.debug) console.log("this=%s\nargs=%s\ndata=%s\n", this, args, data)

        this.name = data.name
        this.location = data.location

        //if (this.dev_conf) {
        //    Object.keys(this.dev_conf).sort().forEach(function(name) {
        //        this.dev_conf[name] = config.devices[dev_conf][name]
        //    })
        //}

        this.checksum = data._
        this.actions = data.actions.sort()

        if (this.actions.includes('TurnOn')) this.setCommand('Fan On', 'TurnOn', null)
        if (this.actions.includes('TurnOff')) this.setCommand('Fan Off', 'TurnOff', null)
        if (this.actions.includes('TurnLightOn')) this.setCommand('Light On', 'TurnLightOn', null)
        if (this.actions.includes('TurnLightOff')) this.setCommand('Light Off', 'TurnLightOff', null)

        this.bridge.emit('device',this)

        this._getProps()
    }

    _getState() {
        this.bridge._queueNext({
            method: 'GET',
            path: '/v2/devices/' + this.device_id + '/state',
            callback: this._processState.bind(this)
        })
    }

    _processState(args, data) {
        if (bh.debug) console.log("this=%s\nargs=%s\ndata=%s\n", this, args, data)
        this._setState(data)
    }

    _getProps() {
        this.bridge._queueNext({
            method: 'GET',
            path: '/v2/devices/' + this.device_id + '/properties',
            callback: this._processProps.bind(this)
        })
        this.bridge._queueNext({
            method: 'GET',
            path: '/v2/devices/' + this.device_id + '/commands',
            callback: this._processCommands.bind(this)
        })
    }

    _processProps(args, data) {
        if (bh.debug) console.log("this=%s\nargs=%s\ndata=%s\n", this, args, data)
        this.max_speed = data.max_speed
        this._getState()
    }

    _processCommands(args, data) {
        if (bh.debug) console.log("this=%s\nargs=%s\ndata=%s\n", this, args, data)
        for (const cmd_id in data) {
            if (cmd_id === '_') continue
            this._getCommandDetails(cmd_id)
        }
    }

    _getCommandDetails(cmd_id) {
        this.bridge._queueNext({
            method: 'GET',
            path: '/v2/devices/' + this.device_id + '/commands/' + cmd_id,
            cmd_id: cmd_id,
            callback: this._processCommandDetails.bind(this)
        })
    }

    _processCommandDetails(args, data) {
        if (bh.debug) console.log("this=%s\nargs=%s\ndata=%s\n", this, args, data)
        this.setCommand(data.name, data.action, data.argument)
    }

    // Update device state in bond bridge
    updateState(state) {
        var data = JSON.stringify(state)

        this.bridge._queueNext({
            method: 'PATCH',
            path: '/v2/devices/' + this.device_id + '/state',
            data: data,
            new_state: state,
            callback: this._processUpdateResult.bind(this)
        })
    }

    _processUpdateResult(args, data) {
        if (bh.debug) console.log("this=%s\nargs=%s\ndata=%s\n", this, args, data)
        if (data.length) {
            console.warn('bridge: %s path: %s error: %s', args.bridge_id, args.path, util.inspect(data).replace(/\s+/gm, ' '))
        }

        this._setState(args.new_state)
    }

    /******************************************************************************/

    _processResult(args, data) {
        if (bh.debug) console.log("this=%s\nargs=%s\ndata=%s\n", this, args, data)
    }

    setCommand(command, action, arg) {
        this.commands[bh.toSlug(command)] = [action, arg]
    }
}

module.exports.BondDevice = BondDevice
