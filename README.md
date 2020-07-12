# route53-dns-challenge-updater

_Stability: 1 - [Experimental](https://github.com/tristanls/stability-index#stability-1---experimental)_

[![NPM version](https://badge.fury.io/js/route53-dns-challenge-updater.svg)](http://npmjs.org/package/route53-dns-challenge-updater)

AWS Route53 DNS challenge updater plugin for Certificate Manager Service.

## Contents

  * [Installation](#installation)
  * [Usage](#usage)
  * [Tests](#tests)
  * [Documentation](#documentation)
    * [Updater.handle(message, context, callback)](#updaterhandlemessage-context-callback)
    * [errors](#errors)
  * [Releases](#releases)

## Installation

The intended usage of `route53-dns-challenge-updater` is as part of [capability-cli](https://github.com/capabilityio/capability-cli) `certificate-manager config aws` functionality.

Alternatively, to install locally:

```
npm install route53-dns-challenge-updater
```

## Usage

This module is intended to be executed as an AWS Lambda function as part of [capability-cli](https://github.com/capabilityio/capability-cli) `certificate-manager config aws` functionality that configures this module as well as grants the requisite permissions and creates required supporting infrastructure.

### Required IAM Permissions:

```yaml
PolicyDocument:
  Version: 2012-10-17
  Statement:
    - Effect: Allow
      Action:
        - "route53:ListHostedZones"
        - "route53:ChangeResourceRecordSets"
        - "route53:GetChange"
      Resource:
        - "*"
```

For a more restricted set, you can limit `route53:ChangeResourceRecordSets` to a specific HostedZoneId:

```yaml
PolicyDocument:
  Version: 2012-10-17
  Statement:
    - Effect: Allow
      Action:
        - "route53:ListHostedZones"
        - "route53:GetChange"
      Resource:
        - "*"
    - Effect: Allow
      Action:
        - "route53:ChangeResourceRecordSets"
      Resource:
        - "arn:aws:route53:::hostedzone/${HostedZoneId}"
```

## Tests

```
npm test
```

## Documentation

  * [Updater.handle(message, context, callback)](#updaterhandlemessage-context-callback)

#### Updater.handle(message, context, callback)

  * `message`: _Object_ Message from Certificate Manager Service requesting a challenge update.
    * `capabilities`: _Object_ Capabilities included in the message.
      * `challengeUpdated`: _CapabilityURI_ Capability to invoke once challenge has been updated.
    * `challenge`: _String_ Challenge to update with.
    * `domain`: _String_ Domain name for which to update the challenge.
  * `context`: _Object_ AWS Lambda context.
  * `callback`: _Function_ `(error, resp) => {}` AWS Lambda callback.

Retrieves AWS Route53 hosted zone id for the `domain`. Creates a `_acme-challenge.${domain}.` TXT record containing the `challenge`. Invokes `capabilities.challengeUpdated` on success, fails otherwise.

### Errors

#### BadRequest

Inbound request message does not match schema.

#### NotFound

Domain to update challenge for not found.

#### ServiceUnavailable

The challenge updater is unavailable, please try again soon.

## Releases

### Policy

We follow the semantic versioning policy ([semver.org](http://semver.org/)) with a caveat:

> Given a version number MAJOR.MINOR.PATCH, increment the:
>
>MAJOR version when you make incompatible API changes,<br/>
>MINOR version when you add functionality in a backwards-compatible manner, and<br/>
>PATCH version when you make backwards-compatible bug fixes.

**caveat**: Major version zero is a special case indicating development version that may make incompatible API changes without incrementing MAJOR version.
