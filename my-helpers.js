'use strict'

const fs = require('fs')

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
    return (exports.isTrue(value) === undefined) ? undefined : (!res)
}

var _slugSeparator

module.exports.setSeparator = function(sep) {
    _slugSeparator = sep
}

module.exports.readConfig = function(file) {
    var config

    if (!file.match(/\//)) file = './' + file

    var data
    try {
        data = fs.readFileSync(file, {
            encoding: 'utf8',
            flag: 'r'
        })
    } catch (err) {
        throw (err)
    }
    if (!data) return undefined

    try {
        config = JSON.parse(data)
    } catch {
        throw ('Unable to parse JSON: ' + file)
    }

    return config
}

String.prototype.toSlug = function(sep = undefined) {
    sep = sep ? sep : _slugSeparator
    // Ignore any string between ()
    return sep ? this.toLowerCase().replace(/\([^)]+\)/g, ' ').replace(/[^\w\d]+/g, ' ').trim().replace(/ /g, sep) : this.toLowerCase().replace(/[\/ ]+/g, ' ').trim()
}
