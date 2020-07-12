/*
 * Copyright 2018-2020 Capability LLC. All Rights Reserved.
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

const errors = require("./errors");
const expectFail = require("./test/expectFail.js");

const Updater = require("./index.js");

const INSTANTIATED_CONFIG = require("./test/config/instantiated.js");
const UNINSTANTIATED_CONFIG = require("./test/config/uninstantiated.js");

it("should instantiate with instantiated config", () =>
    {
        expect(() => new Updater(INSTANTIATED_CONFIG)).not.toThrow();
    }
);

it(`should instantiate on static "handle()" call`, done =>
    {
        process.env.USERDATA = JSON.stringify(UNINSTANTIATED_CONFIG);
        expect(() =>
            {
                Updater.handle(
                    {},
                    {
                        testAbort: true
                    },
                    (error, response) =>
                    {
                        delete process.env.USERDATA;
                        expect(error).toBe(undefined);
                        expect(response).toEqual(new errors.ServiceUnavailable());
                        done();
                    }
                );
            }
        ).not.toThrow();
    }
);
