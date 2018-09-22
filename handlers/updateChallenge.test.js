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

const CapabilityToken = require("capability-token");
const CapabilityURI = require("capability-uri");
const clone = require("clone");
const countdown = require("../test/countdown.js");

const Updater = require("../index.js");

const CHANGE_INFO_ID = "my-change-info-id";
const INSTANTIATED_CONFIG = require("../test/config/instantiated.js");
const HOSTED_ZONE_ID = "ARGHAHA";
const UPDATE_CHALLENGE =
{
    capabilities:
    {
        challengeUpdated: new CapabilityURI(
            {
                authority: "membrane.example.com",
                capabilityToken: new CapabilityToken()
            }
        ).serialize()
    },
    challenge: "some-challenge",
    domain: "my.domain.at.example.com"
};

describe("UpdateChallenge", () =>
{
    let config;
    beforeEach(() =>
        {
            jest.resetModules();
            config = clone(INSTANTIATED_CONFIG);
        }
    );
    describe("invalid message", () =>
    {
        [
            "capabilities", "challenge", "domain"
        ]
        .map(prop =>
        {
            describe(`missing "${prop}"`, () =>
            {
                it("returns 400 Bad Request", done =>
                    {
                        const lambda = new Updater(config);
                        const msg = clone(UPDATE_CHALLENGE);
                        delete msg[prop];
                        lambda.handle(
                            msg,
                            {},
                            (error, resp) =>
                            {
                                expect(error).toBe(undefined);
                                expect(resp).toEqual(
                                    {
                                        statusCode: 400,
                                        error: "Bad Request",
                                        message: `Invalid ${prop}`
                                    }
                                );
                                done();
                            }
                        );
                    }
                );
            });
        });
    });
    describe("retrieves hosted zone id for domain", () =>
    {
        it("if error, returns 503 Service Unavailable", done =>
            {
                const finish = countdown(done, 3);
                const mock =
                {
                    finish,
                    listHostedZonesCallCount: 0
                };
                jest.mock("aws-sdk", () => (
                    {
                        Route53: function()
                        {
                            return (
                                {
                                    listHostedZones(params, callback)
                                    {
                                        mock.listHostedZonesCallCount++;
                                        if (mock.listHostedZonesCallCount == 1)
                                        {
                                            expect(params).toEqual({});
                                        }
                                        else
                                        {
                                            expect(params).toEqual(
                                                {
                                                    Marker: "next-marker-thingy"
                                                }
                                            );
                                        }
                                        mock.finish();
                                        if (mock.listHostedZonesCallCount < 2)
                                        {
                                            return callback(undefined,
                                                {
                                                    HostedZones: [],
                                                    IsTruncated: true,
                                                    NextMarker: "next-marker-thingy"
                                                }
                                            );
                                        }
                                        return callback(new Error("boom"));
                                    }
                                }
                            );
                        }
                    }
                ));
                const lambda = new (require("../index.js"))(config);
                lambda.handle(
                    clone(UPDATE_CHALLENGE),
                    {},
                    (error, resp) =>
                    {
                        expect(error).toBe(undefined);
                        expect(resp).toEqual(Updater.SERVICE_UNAVAILABLE);
                        finish();
                    }
                );
            }
        );
        it("if domain not found, returns 404 Not Found", done =>
            {
                const finish = countdown(done, 3);
                const mock =
                {
                    finish,
                    listHostedZonesCallCount: 0
                };
                jest.mock("aws-sdk", () => (
                    {
                        Route53: function()
                        {
                            return (
                                {
                                    listHostedZones(params, callback)
                                    {
                                        mock.listHostedZonesCallCount++;
                                        if (mock.listHostedZonesCallCount == 1)
                                        {
                                            expect(params).toEqual({});
                                        }
                                        else
                                        {
                                            expect(params).toEqual(
                                                {
                                                    Marker: "next-marker-thingy"
                                                }
                                            );
                                        }
                                        mock.finish();
                                        if (mock.listHostedZonesCallCount < 2)
                                        {
                                            return callback(undefined,
                                                {
                                                    HostedZones: [],
                                                    IsTruncated: true,
                                                    NextMarker: "next-marker-thingy"
                                                }
                                            );
                                        }
                                        return callback(undefined,
                                            {
                                                HostedZones: []
                                            }
                                        );
                                    }
                                }
                            );
                        }
                    }
                ));
                const lambda = new (require("../index.js"))(config);
                lambda.handle(
                    clone(UPDATE_CHALLENGE),
                    {},
                    (error, resp) =>
                    {
                        expect(error).toBe(undefined);
                        expect(resp).toEqual(
                            {
                                statusCode: 404,
                                error: "Not Found",
                                message: `Domain ${UPDATE_CHALLENGE.domain} not found`
                            }
                        );
                        finish();
                    }
                );
            }
        );
    });
    describe("creates DNS TXT record", () =>
    {
        it("if error, returns 503 Service Unavailable", done =>
            {
                const finish = countdown(done, 2);
                const mock =
                {
                    finish,
                    HOSTED_ZONE_ID,
                    UPDATE_CHALLENGE
                };
                jest.mock("aws-sdk", () => (
                    {
                        Route53: function()
                        {
                            return (
                                {
                                    changeResourceRecordSets(params, callback)
                                    {
                                        expect(params).toEqual(
                                            {
                                                ChangeBatch:
                                                {
                                                    Changes:
                                                    [
                                                        {
                                                            Action: "UPSERT",
                                                            ResourceRecordSet:
                                                            {
                                                                Name: `_acme-challenge.${mock.UPDATE_CHALLENGE.domain}.`,
                                                                ResourceRecords:
                                                                [
                                                                    {
                                                                        Value: `"${mock.UPDATE_CHALLENGE.challenge}"`
                                                                    }
                                                                ],
                                                                TTL: 5,
                                                                Type: "TXT"
                                                            }
                                                        }
                                                    ]
                                                },
                                                HostedZoneId: mock.HOSTED_ZONE_ID
                                            }
                                        );
                                        mock.finish()
                                        return callback(new Error("boom"));
                                    },
                                    listHostedZones(params, callback)
                                    {
                                        return callback(undefined,
                                            {
                                                HostedZones:
                                                [
                                                    {
                                                        Id: `/hostedzone/${mock.HOSTED_ZONE_ID}`,
                                                        Name: `${mock.UPDATE_CHALLENGE.domain}.`
                                                    }
                                                ]
                                            }
                                        );
                                    }
                                }
                            );
                        }
                    }
                ));
                const lambda = new (require("../index.js"))(config);
                lambda.handle(
                    clone(UPDATE_CHALLENGE),
                    {},
                    (error, resp) =>
                    {
                        expect(error).toBe(undefined);
                        expect(resp).toEqual(Updater.SERVICE_UNAVAILABLE);
                        finish();
                    }
                );
            }
        );
    });
    describe("waits for Route53 change to sync", () =>
    {
        it("if error, returns 503 Service Unavailable", done =>
            {
                const finish = countdown(done, 3);
                const mock =
                {
                    CHANGE_INFO_ID,
                    finish,
                    getChangeCallCount: 0,
                    HOSTED_ZONE_ID,
                    UPDATE_CHALLENGE
                };
                jest.mock("aws-sdk", () => (
                    {
                        Route53: function()
                        {
                            return (
                                {
                                    changeResourceRecordSets(params, callback)
                                    {
                                        return callback(undefined,
                                            {
                                                ChangeInfo:
                                                {
                                                    Id: mock.CHANGE_INFO_ID,
                                                    Status: "NOPE"
                                                }
                                            }
                                        );
                                    },
                                    getChange(params, callback)
                                    {
                                        mock.getChangeCallCount++;
                                        mock.finish();
                                        if (mock.getChangeCallCount == 1)
                                        {
                                            return callback(undefined,
                                                {
                                                    ChangeInfo:
                                                    {
                                                        Id: mock.CHANGE_INFO_ID,
                                                        Status: "NOPE"
                                                    }
                                                }
                                            );
                                        }
                                        return callback(new Error("boom"));
                                    },
                                    listHostedZones(params, callback)
                                    {
                                        return callback(undefined,
                                            {
                                                HostedZones:
                                                [
                                                    {
                                                        Id: `/hostedzone/${mock.HOSTED_ZONE_ID}`,
                                                        Name: `${mock.UPDATE_CHALLENGE.domain}.`
                                                    }
                                                ]
                                            }
                                        );
                                    }
                                }
                            );
                        }
                    }
                ));
                const lambda = new (require("../index.js"))(config);
                lambda.handle(
                    clone(UPDATE_CHALLENGE),
                    {},
                    (error, resp) =>
                    {
                        expect(error).toBe(undefined);
                        expect(resp).toEqual(Updater.SERVICE_UNAVAILABLE);
                        finish();
                    }
                );
            },
            7000
        );
    });
    describe("notifies ChallengeUpdated", () =>
    {
        it("if error, responds 503 Service Unavailable", done =>
            {
                const finish = countdown(done, 2);
                const mock =
                {
                    CHANGE_INFO_ID,
                    finish,
                    HOSTED_ZONE_ID,
                    UPDATE_CHALLENGE
                };
                jest.mock("aws-sdk", () => (
                    {
                        Route53: function()
                        {
                            return (
                                {
                                    changeResourceRecordSets(params, callback)
                                    {
                                        return callback(undefined,
                                            {
                                                ChangeInfo:
                                                {
                                                    Id: mock.CHANGE_INFO_ID,
                                                    Status: "NOPE"
                                                }
                                            }
                                        );
                                    },
                                    getChange(params, callback)
                                    {
                                        return callback(undefined,
                                            {
                                                ChangeInfo:
                                                {
                                                    Id: mock.CHANGE_INFO_ID,
                                                    Status: "INSYNC"
                                                }
                                            }
                                        );
                                    },
                                    listHostedZones(params, callback)
                                    {
                                        return callback(undefined,
                                            {
                                                HostedZones:
                                                [
                                                    {
                                                        Id: `/hostedzone/${mock.HOSTED_ZONE_ID}`,
                                                        Name: `${mock.UPDATE_CHALLENGE.domain}.`
                                                    }
                                                ]
                                            }
                                        );
                                    }
                                }
                            );
                        }
                    }
                ));
                jest.mock("capability-sdk", () => (
                    {
                        requestReply(capability, options, data, callback)
                        {
                            expect(capability).toEqual(mock.UPDATE_CHALLENGE.capabilities.challengeUpdated);
                            expect(options).toBe(undefined);
                            expect(data).toBe(undefined);
                            mock.finish();
                            return callback(new Error("boom"));
                        }
                    }
                ));
                const lambda = new (require("../index.js"))(config);
                lambda.handle(
                    clone(UPDATE_CHALLENGE),
                    {},
                    (error, resp) =>
                    {
                        expect(error).toBe(undefined);
                        expect(resp).toEqual(Updater.SERVICE_UNAVAILABLE);
                        finish();
                    }
                );
            }
        );
        it("if success, succeeds", done =>
            {
                const finish = countdown(done, 2);
                const mock =
                {
                    CHANGE_INFO_ID,
                    finish,
                    HOSTED_ZONE_ID,
                    UPDATE_CHALLENGE
                };
                jest.mock("aws-sdk", () => (
                    {
                        Route53: function()
                        {
                            return (
                                {
                                    changeResourceRecordSets(params, callback)
                                    {
                                        return callback(undefined,
                                            {
                                                ChangeInfo:
                                                {
                                                    Id: mock.CHANGE_INFO_ID,
                                                    Status: "NOPE"
                                                }
                                            }
                                        );
                                    },
                                    getChange(params, callback)
                                    {
                                        return callback(undefined,
                                            {
                                                ChangeInfo:
                                                {
                                                    Id: mock.CHANGE_INFO_ID,
                                                    Status: "INSYNC"
                                                }
                                            }
                                        );
                                    },
                                    listHostedZones(params, callback)
                                    {
                                        return callback(undefined,
                                            {
                                                HostedZones:
                                                [
                                                    {
                                                        Id: `/hostedzone/${mock.HOSTED_ZONE_ID}`,
                                                        Name: `${mock.UPDATE_CHALLENGE.domain}.`
                                                    }
                                                ]
                                            }
                                        );
                                    }
                                }
                            );
                        }
                    }
                ));
                jest.mock("capability-sdk", () => (
                    {
                        requestReply(capability, options, data, callback)
                        {
                            expect(capability).toEqual(mock.UPDATE_CHALLENGE.capabilities.challengeUpdated);
                            expect(options).toBe(undefined);
                            expect(data).toBe(undefined);
                            mock.finish();
                            return callback(undefined,
                                {
                                    statusCode: 202,
                                    message: "Accepted"
                                }
                            );
                        }
                    }
                ));
                const lambda = new (require("../index.js"))(config);
                lambda.handle(
                    clone(UPDATE_CHALLENGE),
                    {},
                    (error, resp) =>
                    {
                        expect(error).toBe(undefined);
                        expect(resp).toBe(undefined);
                        finish();
                    }
                );
            }
        );
    });
});
