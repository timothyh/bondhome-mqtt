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
    var name = config.cover_name ? config.cover_name : device.name
    var manu = config.manufacturer ? config.manufacturer : 'BondHome'
    var model
    if ( config.model ) {
	    model = config.model
    } else {
            model = ((device.template && device.template.length > 2) ? device.template : 'N/A')
    }
    var attr = {
        'command_topic': prefix + '/' + devSlug + '/set/command',
        'device': {
            'identifiers': id + '-cover',
            'manufacturer': manu,
            'model': model,
            'name': device.name,
            'via_device': 'bond-' + device.bridge.bridge_id.toUpperCase()
        },
        'name': name,
        'payload_close': 'close',
        'payload_stop': 'my',
        'payload_open': 'open',
        'position_closed': 0,
        'position_open': 1,
        'position_topic': prefix + '/' + devSlug + '/open',
        'unique_id': id + '-cover'
    }
    res["cover/" + devSlug] = attr
 
    return res
}
