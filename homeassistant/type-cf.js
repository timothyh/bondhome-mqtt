'use strict'

// Returns associative array data structure
// homeassistant_type/device_slug => homeassistant definition as associative array

// Inputs:
//   device slug
//   Bondhome MQTT topic prefix (from config file)
//   Internal config data structure

module.exports.hassConfig = function(devSlug, prefix, config) {
    var device = config._device
    var res = {}

    var id = 'bond-' + device.bridge.bridge_id.toLowerCase() + '-' + device.device_id.toLowerCase()
    var name = config.fan_name ? config.fan_name : device.name
    var manu = config.manufacturer ? config.manufacturer : 'BondHome'
    var model
    if ( config.model ) {
	    model = config.model
    } else {
            model = ((device.template && device.template.length > 2) ? device.template : 'N/A')
    }
    var attr = {
        'command_topic': prefix + '/' + devSlug + '/set/fan',
        'device': {
            'identifiers': id + '-fan',
            'manufacturer': manu,
            'model': model,
            'name': device.name,
            'via_device': 'bond-' + device.bridge.bridge_id.toUpperCase()
        },
        'name': name,
        'payload_off': '0',
        'payload_on': '1',
        'state_topic': prefix + '/' + devSlug + '/power',
        'unique_id': id + '-fan'
    }
    if (device.max_speed >= 1) {
        attr.percentage_command_topic = prefix + '/' + devSlug + '/set/percentage'
        attr.percentage_state_topic = prefix + '/' + devSlug + '/percentage'
    }
    res["fan/" + devSlug] = attr
    if (config.has_light) {
        var name = config.light_name ? config.light_name : device.name + ' Light'
        var attr = {
            'command_topic': prefix + '/' + devSlug + '/set/light',
            'device': {
                'identifiers': id + '-lit',
                'manufacturer': manu,
                'model': model,
                'name': device.name + '(Light)',
                'via_device': id + '-fan'
            },
            'name': name,
            'payload_off': '0',
            'payload_on': '1',
            'state_topic': prefix + '/' + devSlug + '/light',
            'unique_id': id + '-lit'
        }
        res["light/" + devSlug] = attr
    }
    return res
}
