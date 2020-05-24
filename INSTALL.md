# Installation

These instructions assume installation into the /opt/bondhome-mqtt directory and the use of systemd to manage the bondhome-mqtt process.

They have been _lightly_ tested and should be treated as a general guide. Your mileage may vary.

1) Install NodeJS and NPM - Instructions for Debian (Ubuntu, Raspbian) type distributions can be found at
https://github.com/nodesource/distributions#installation-instructions

2) Clone this Git repo to target location:-

```$ git clone git@github.com:timothyh/bondhome-mqtt.git /opt/bondhome-mqtt```

3) Install required Node modules

```$ cd /opt/bondhome-mqtt
$ npm install
```

4) Generate an initial configuration
- Power cycle the Bond Home devices on your network.
- Run the discover utility to generate an initial configuration file
```$ cd /opt/bondhome-mqtt
$ node discover.js --config
discovered bridge: ZZZZ99999
discovered device: bridge: ZZZZ99999 device: Office Fan
Sample configuration file follows
--------------------------------------------------------------
{
  "bridges": {
    "ZZZZ99999": {
      "local_token": "123456789abcdef0",
      "ip_address": "192.168.1.190"
    }
  },
  "verbose": true
}
```
- Copy the above JSON output into a local configuration file - config.json
- The syntax can be checked using the `jq` command
```$ jq . < config.json```
- The default configuration assumes an MQTT broker on localhost with no credentials required. If that's not the case, the MQTT broker settings may have to be adjusted. MQTT broker settings can be seen in `examples/config.json.sample`.
- Test installation and initial configuration file
```$ node bondhome-mqtt
discovered bridge: ZZZZ999999
connected to MQTT broker: localhost:1883
......
Ctrl-C
```

4) Install the systemd service
```$ sudo su -
# useradd -r nodejs
# cp -p /opt/bondhome-mqtt/bondhome-mqtt.service /etc/systemd/system
# systemctl daemon-reload
# systemctl enable bondhome-mqtt
# systemctl start bondhome-mqtt
# systemctl status bondhome-mqtt
```

5) Verify operation.

This assume a default topic prefix of `bondhome`.
```$ mosquitto_sub -v -h localhost -t 'bondhome/#'```
When the Bond Home application is used, there should be status updates of the form
```
bondhome/device_slug/power 1
bondhome/device_slug/speed 2
bondhome/device_slug/light 1
```

6) Initial troubleshooting
- Use the `journalctl` command to see output:-
```journalctl -u bondhome-mqtt -f```
