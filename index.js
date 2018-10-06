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
const clone = require("clone");
const events = require("events");
const instrument = require("telemetry-events-instrument-method");
const Joi = require("joi");
const LogTelemetryEvents = require("telemetry-events-log");
const markTime = require("mark-time");
const pkg = require("./package.json");
const QuantifyTelemetryEvents = require("telemetry-events-quantify");
const TelemetryEvents = require("telemetry-events");
const TraceTelemetryEvents = require("telemetry-events-trace");

class Updater extends events.EventEmitter
{
    constructor(config)
    {
        super();

        const self = this;
        self.SERVICE_UNAVAILABLE = SERVICE_UNAVAILABLE;
        self.name = pkg.name;
        self.version = pkg.version;

        self._config = config;

        const configValidationResult = Joi.validate(
            self._config,
            Updater.SCHEMA.config.instantiated,
            {
                abortEarly: false,
                convert: false
            }
        );
        if (configValidationResult.error)
        {
            throw configValidationResult.error;
        }

        self._route53 = new AWS.Route53();
        self._stderrTelemetry = self._config.stderrTelemetry ? true : false;

        self._telemetry = new TelemetryEvents(
            {
                package: pkg,
                emitter: self
            }
        );
        self._logs = new LogTelemetryEvents(
            {
                telemetry: self._telemetry
            }
        );
        self._log = self._logs.log;
        self._metrics = new QuantifyTelemetryEvents(
            {
                telemetry: self._telemetry
            }
        );
        self._tracing = new TraceTelemetryEvents(
            {
                telemetry: self._telemetry
            }
        );
        if (self._stderrTelemetry)
        {
            self.on("telemetry", event =>
                {
                    try
                    {
                        // clone handles circular dependencies
                        console.error(JSON.stringify(clone(event)));
                    }
                    catch (error)
                    {
                        console.error(`{"type":"log","level":"error","message":"Failed to write telemetry with type ${event.type}"}`);
                        console.error(error);
                        console.error(event);
                    }
                }
            );
        }

        self._instrument = params => instrument(
            {
                ...params,
                telemetry:
                {
                    logs: self._logs,
                    metrics: self._metrics
                }
            }
        );
    }

    static config(config, callback)
    {
        const configValidationResult = Joi.validate(
            config,
            Updater.SCHEMA.config.uninstantiated,
            {
                abortEarly: false,
                convert: false
            }
        );
        if (configValidationResult.error)
        {
            throw configValidationResult.error;
        }
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
        self._startTime = markTime();
        self._requestId = context.awsRequestId;
        self._metadata =
        {
            action: "UpdateChallenge"
        };
        if (message.context && message.context.parentSpan)
        {
            const incomingTrace = self._tracing.extract("text_map", message.context.parentSpan);
            if (incomingTrace)
            {
                self._parentSpan = incomingTrace.followingSpan("updateChallenge");
            }
        }
        if (!self._parentSpan)
        {
            self._parentSpan = self._tracing.trace("updateChallenge");
        }
        self._parentSpan.tag("requestId", self._requestId);

        if (context.testAbort)
        {
            return self._end(SERVICE_UNAVAILABLE);
        }
        return self._updateChallenge(message, context);
    }

    _end(error, response)
    {
        const self = this;
        self._metrics.gauge("latency",
            {
                unit: "ms",
                value: markTime() - self._startTime,
                metadata: self._metadata
            }
        );
        if (self._parentSpan)
        {
            self._parentSpan.finish();
            self._parentSpan = undefined;
        }
        setImmediate(_ => self.emit("end"));
        // Non-crash errors are treated as successful Lambda executions and
        // passed in place of a response.
        setImmediate(_ => _callback(undefined, error ? error : response));
    }
};

Updater.SCHEMA =
{
    config:
    {
        instantiated: require("./schema/config/instantiated.js"),
        uninstantiated: require("./schema/config/uninstantiated.js")
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
