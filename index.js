/*
 * Copyright 2018 Capability LLC. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
"use strict";

const SERVICE_UNAVAILABLE =
{
    statusCode: 503,
    error: "Service Unavailable",
    message: "Please try again soon"
};

// Do not leak error information when loading code.
// Unexpected errors may return 503 Service Unavailable or just exit.
let _callback;
process.on("uncaughtException", error =>
    {
        console.error(error);
        if (_callback)
        {
            return _callback(undefined, SERVICE_UNAVAILABLE);
        }
        process.exit(1);
    }
);

const AWS = require("aws-sdk");
const CapabilitySDK = require("capability-sdk");
const events = require("events");
const pkg = require("./package.json");

class Updater extends events.EventEmitter
{
    constructor(config)
    {
        super();

        const self = this;
        self.SERVICE_UNAVAILABLE = SERVICE_UNAVAILABLE;
        self._config = config;
        self.name = pkg.name;
        self.version = pkg.version;

        self._route53 = new AWS.Route53();
    }

    static config(config, callback)
    {
        return callback(config);
    }

    static handle(message, context, callback)
    {
        _callback = callback; // return 503 Service Unavailable on uncaught error
        if (!Updater.instance)
        {
            const userdata = process.env.USERDATA || "{}"; // support empty config
            Updater.config(JSON.parse(userdata), config =>
                {
                    Updater.instance = new Updater(config);
                    Updater.instance.handle(message, context, callback);
                }
            );
        }
        else
        {
            Updater.instance.handle(message, context, callback);
        }
    }

    handle(message, context, callback)
    {
        _callback = callback; // testing artifact
        const self = this;
        if (context.testAbort)
        {
            return self._end(SERVICE_UNAVAILABLE);
        }
        return self._updateChallenge(message, context);
    }

    _end(error, response)
    {
        const self = this;
        setImmediate(_ => self.emit("end"));
        // Non-crash errors are treated as successful Lambda executions and
        // passed in place of a response.
        setImmediate(_ => _callback(undefined, error ? error : response));
    }
};

Updater.SERVICE_UNAVAILABLE = SERVICE_UNAVAILABLE;
Updater.instance = undefined;
Updater.version = pkg.version;

[
    "updateChallenge"
]
.map(handler =>
    {
        Updater.prototype[`_${handler}`] = require(`./handlers/${handler}.js`);
    }
);

module.exports = Updater;
