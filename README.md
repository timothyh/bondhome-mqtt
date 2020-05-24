# bondhome-mqtt

Gateway between MQTT and Bond Home bridges and devices

## TLDR

Enables the use of MQTT to control BondHome bridges and devices.

For example the following MQTT message will turn on the Living Room Fan:-

  Topic: `bondhome/living_room_fan/set/command` Payload: `Fan On`

Similarly, MQTT messages with status updates for BondHome bridges and devices. For example, the above message will cause the following status update to be published on MQTT:-

  Topic: `bondhome/living_room_fan/fan` Payload: `1`
  
Also supports MQTT integration with HomeAssistant

## Installation

See INSTALL.md

## Configuration

See examples/config.json.sample

## Usage


## FAQ

* What's a SLUG

See https://en.wikipedia.org/wiki/Clean_URL#Slug

* What's a command?

Typically each button on the associated remote control represents a command. Examples include
    * Toggle Light
    * Speed 2
    * Fan Off
Use the Bond Home application to see the commands associated with a specific device.

See also http://docs-local.appbond.com/#section/Glossary/Commands

* What's an action?

See http://docs-local.appbond.com/#section/Glossary/Action

* What's the difference between a command and an action

* Why is this gateway needed - Doesn't BondHome support MQTT directly?

* Can I use this gateway to program my BondHome devices
No - Use Bond Home application or Bond Home CLI - https://github.com/bondhome/bond-cli

For BondHome API see See http://docs-local.appbond.com/
