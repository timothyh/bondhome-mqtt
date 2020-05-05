'use strict'

module.exports.isTrue = function(value) {

    if (typeof(value) === 'boolean') return value

    var tmpnum = parseInt(value)
    if (!isNaN(tmpnum)) {
        return tmpnum !== 0
    }

    if (typeof(value) === 'string') value = value.trim().toLowerCase()

    switch (value) {
        case 'true':
        case 'on':
        case 'y':
        case 'yes':
            return true
            break
        case 'false':
        case 'off':
        case 'n':
        case 'no':
            return false
            break
    }
    return undefined
}

module.exports.isFalse = function(value) {
    var res = exports.isTrue(value)
    return ( exports.isTrue(value) === undefined ) ? undefined : (!res)
}

var _slugSeparator

module.exports.setSeparator = function(sep) {
    _slugSeparator = sep
}

String.prototype.toSlug = function() {
        // Ignore any string between ()
        return _slugSeparator ? this.toLowerCase().replace(/\([^)]+\)/g, ' ').replace(/[^\w\d]+/g, ' ').trim().replace(/ /g, _slugSeparator) : this.toLowerCase().replace(/[\/ ]+/g, ' ').trim()
    }
