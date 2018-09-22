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

const CapabilitySDK = require("capability-sdk");
const events = require("events");
const Joi = require("joi");
const schema = require("../schema/updateChallenge.js");

module.exports = function(message, context)
{
    const self = this;
    const validationResult = Joi.validate(message, schema,
        {
            abortEarly: true,
            convert: true
        }
    );
    if (validationResult.error)
    {
        return self._end(
            {
                statusCode: 400,
                error: "Bad Request",
                message: `Invalid ${validationResult.error.details[0].path.join(".")}`
            }
        );
    }
    const workflow = new events.EventEmitter();
    setImmediate(() => workflow.emit("start", {}));
    workflow.on("start", dataBag => workflow.emit("retrieve hosted zone id for domain", dataBag));
    workflow.on("retrieve hosted zone id for domain", dataBag =>
        {
            const params = Object.assign({},
                {
                    Marker: dataBag.nextMarker
                }
            );
            self._route53.listHostedZones(params, (error, resp) =>
                {
                    if (error)
                    {
                        return self._end(self.SERVICE_UNAVAILABLE);
                    }
                    const hostedZone = resp.HostedZones
                        .filter(zone => zone.Name === `${message.domain}.`);
                    if (hostedZone.length == 0 && resp.IsTruncated)
                    {
                        dataBag.nextMarker = resp.NextMarker;
                        return workflow.emit("retrieve hosted zone id for domain", dataBag);
                    }
                    else if (hostedZone.length == 0)
                    {
                        return self._end(
                            {
                                statusCode: 404,
                                error: "Not Found",
                                message: `Domain ${message.domain} not found`
                            }
                        );
                    }
                    dataBag.hostedZoneId = hostedZone[0].Id.match(/\/hostedzone\/(.*)$/)[1];
                    return workflow.emit("create DNS TXT record", dataBag);
                }
            );
        }
    );
    workflow.on("create DNS TXT record", dataBag =>
        {
            const params =
            {
                ChangeBatch:
                {
                    Changes:
                    [
                        {
                            Action: "UPSERT",
                            ResourceRecordSet:
                            {
                                Name: `_acme-challenge.${message.domain}.`,
                                ResourceRecords:
                                [
                                    {
                                        Value: `"${message.challenge}"`
                                    }
                                ],
                                TTL: 5,
                                Type: "TXT"
                            }
                        }
                    ]
                },
                HostedZoneId: dataBag.hostedZoneId
            };
            self._route53.changeResourceRecordSets(params, (error, resp) =>
                {
                    if (error)
                    {
                        return self._end(self.SERVICE_UNAVAILABLE);
                    }
                    dataBag.changeId = resp.ChangeInfo.Id;
                    return workflow.emit("wait for Route53 change to sync", dataBag);
                }
            );
        }
    );
    workflow.on("wait for Route53 change to sync", dataBag =>
        {
            const params =
            {
                Id: dataBag.changeId
            };
            self._route53.getChange(params, (error, resp) =>
                {
                    if (error)
                    {
                        return self._end(self.SERVICE_UNAVAILABLE);
                    }
                    if (resp.ChangeInfo.Status != "INSYNC")
                    {
                        return setTimeout(
                            () => workflow.emit("wait for Route53 change to sync", dataBag),
                            5000
                        );
                    }
                    return workflow.emit("notify challenge updated", dataBag);
                }
            );
        }
    );
    workflow.on("notify challenge updated", dataBag =>
        {
            CapabilitySDK.requestReply(
                message.capabilities.challengeUpdated,
                undefined,
                undefined,
                (error, resp) =>
                {
                    if (error)
                    {
                        return self._end(self.SERVICE_UNAVAILABLE);
                    }
                    return self._end();
                }
            );
        }
    );
};
