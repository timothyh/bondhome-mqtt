# bondhome-mqtt

Gateway between MQTT and Bond Home bridges and devices

# TLDR

Enables the use of MQTT to control BondHome bridges and devices.

For example the following MQTT message will turn on the Living Room Fan:-

  Topic: `bondhome/living_room_fan/set/command` Payload: `Fan On`

Similarly, MQTT messages with status updates for BondHome bridges and devices. For example, the above message will cause the following status update to be published on MQTT:-

  Topic: `bondhome/living_room_fan/fan` Payload: `1`
  
Also supports MQTT integration with HomeAssistant

# Installation

1) Install NodeJS and NPM - Instructions for Debian (Ubuntu, Raspbian) type environments can be found at
https://github.com/nodesource/distributions#installation-instructions

2) Clone this Git repo to target location:-

```$ git clone git@github.com:timothyh/bondhome-mqtt.git /opt/bondhome-mqtt```

3) Install required Node modules

```$ cd /opt/bondhome-mqtt
$ npm install
```


# FAQ

What's the difference between a command and an action

Why is this gateway needed - Doesn't BondHome support MQTT directly

Can I use this gateway to program my BondHome devices

For BondHome API see See http://docs-local.appbond.com/
