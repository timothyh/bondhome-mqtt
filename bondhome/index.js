'use strict'

const bh = require('./bondhome')

module.exports.BondHome = bh.BondHome
module.exports.BondHome.debug = bh.BondHome.debug
module.exports.BondHome.verbose = bh.BondHome.verbose
module.exports.discover = bh.BondHome.discover
module.exports.events = bh.BondHome.events
module.exports.findBridge = bh.BondHome.findBridge

module.exports.BondBridge = require('./bondbridge').BondBridge
module.exports.BondDevice = require('./bonddevice').BondDevice
