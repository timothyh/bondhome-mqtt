BondHome Public API

var bond = require('./bondhome')

class BondHome 
    static bpupListen() 
    static discover() 
    static enableBpup(ip) 
    static events() 
    static findBridge(id) 
    static setSeparator(sep) 
    static toSlug(value) 

class BondBridge
    constructor(id, ip = undefined, token = undefined) 
    destroy() 
    refresh() 

class BondDevice 
    constructor(bridge, dev_id) 
    sendCommand(cmd, repeat = 1, interval = undefined) 
    sendAction(action, arg, repeat = 1, interval = undefined) 
    setCommand(command, action, arg) 
    updateState(state) 
