/*
	Redis2JSON library
	http://github.com/igo/redis2json
	
	Copyright (c) 2010 by Igor Urmincek

	Permission is hereby granted, free of charge, to any person obtaining a copy
	of this software and associated documentation files (the "Software"), to deal
	in the Software without restriction, including without limitation the rights
	to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
	copies of the Software, and to permit persons to whom the Software is
	furnished to do so, subject to the following conditions:

	The above copyright notice and this permission notice shall be included in
	all copies or substantial portions of the Software.

	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
	IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
	FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
	AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
	LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
	OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
	THE SOFTWARE.
*/


var sys = require('sys'),
	redislib = require("./redis-client"),
	async = require('./async');

exports.debugMode = false;
exports.redis = undefined;


var clone = function(obj) {
  var newObj = (obj instanceof Array) ? [] : {};
  for (i in obj) {
    if (i == 'clone') continue;
    if (obj[i] && typeof obj[i] == "object") {
      newObj[i] = clone(obj[i]);
    } else newObj[i] = obj[i]
  } return newObj;
};


var fillVariables = function (text, variables) {
	var newText = text;
	for(var prop in variables) {
		if(variables.hasOwnProperty(prop)) {
			newText = newText.replace("{" + prop + "}", variables[prop]);
		}
	}
	return newText;
}


var loadValue = function (key, redisKey, variables) {
	return function (callback) {
		var expandedRedisKey = fillVariables(redisKey, variables);
		if (redisKey.substr(0, 1) == ":") { // static string
			var o = {};
			o[key] = expandedRedisKey.substr(1);
			callback(null, o)
		} else { // redis key
			exports.redis.get(expandedRedisKey, function (error, value) {
				if (key) {
					var o = {};
					o[key] = value;
					redislib.convertMultiBulkBuffersToUTF8Strings(o);
					callback(error, o);
				} else {
					callback(error, value)
				}
			});
		}
	}
}


var loadArray = function (key, map, variables, arrayCommand) {
	return function (callback) {
		if (exports.debugMode)
			sys.log("LOAD ARRAY " + key + " ; cmd: " + JSON.stringify(arrayCommand));
		var expandedRedisKey = fillVariables(arrayCommand.key, variables);
		var args = arrayCommand.args || [];
		args.unshift(expandedRedisKey);
		args.push(function (error, array) {
			if (array) { // array is not empty
				redislib.convertMultiBulkBuffersToUTF8Strings(array);
				if (exports.debugMode)
					sys.log("REDIS ARRAY LOADED " + JSON.stringify(array));
				var actions = [];
				for (var i=0; i < array.length; i++) {
					var newVars = clone(variables);
					newVars[arrayCommand.variable] = array[i];
					if (exports.debugMode)
						sys.log("LOAD ARRAY vars: " + array[i] + " ; " + JSON.stringify(newVars));

					// collect actions that will be loaded
					for (var prop in map) {
						if(map.hasOwnProperty(prop) && prop.substr(0, 1) != "$") {
							if (typeof map[prop] === "string") {
								actions.push(loadValue(null, map[prop], newVars));
							} else if (typeof map[prop] === "object") {
								if (Array.isArray(map[prop])) {
									actions.push(loadArray(null, map[prop], newVars, clone(map["$$" + prop])));
								} else {
									actions.push(loadObject(null, map[prop], newVars));
								}
							}
						}
					}
				}
				async.parallel(actions, function (error, results) {
					if (key) {
						var o = {};
						o[key] = results;
						callback(error, o);
					} else {
						callback(error, o)
					}
				});				
			} else { // array is empty
				if (key) {
					var o = {};
					o[key] = [];
					callback(null, o);
				} else {
					callback(error, [])
				}
			}
		});
		exports.redis[arrayCommand.cmd].apply(exports.redis, args);
	}
}


var loadObject = function (key, map, variables) {
	return function (callback) {
		if (exports.debugMode)
			sys.log("LOAD OBJECT " + key + " with variables " + JSON.stringify(variables));
		var loadVarsActions = [];
		
		// collect actions that load new variables
		for (var prop in map) {
			if(map.hasOwnProperty(prop) && prop.substr(0, 1) == "$" && prop.substr(1, 1) != "$") {
				if (typeof map[prop] === "string") {
					loadVarsActions.push(loadValue(prop.substr(1), map[prop], variables));
				}
			}
		}
		
		// load variables
		async.parallel(loadVarsActions, function (error, results) {
			for (var i=0; i < results.length; i++) {
				for (var prop in results[i]) {
					variables[prop] = results[i][prop];
				}
			};
			
			// collect actions that will be loaded
			var loadActions = [];
			for (var prop in map) {
				if(map.hasOwnProperty(prop) && prop.substr(0, 1) != "$") {
					if (typeof map[prop] === "string") {
						loadActions.push(loadValue(prop, map[prop], variables));
					} else if (typeof map[prop] === "object") {
						if (Array.isArray(map[prop])) {
							loadActions.push(loadArray(prop, map[prop], clone(variables), clone(map["$$" + prop])));
						} else {
							loadActions.push(loadObject(prop, map[prop], clone(variables)));
						}
					}
				}
			}

			// load values, objects, arrays
			async.parallel(loadActions, function (error, results) {
				var o = {};
				for (var i=0; i < results.length; i++) {
					for (var prop in results[i]) {
						o[prop] = results[i][prop];
					}
				};
				if (key) {
					var o2 = {};
					o2[key] = o;
					callback(error, o2);
				} else {
					callback(error, o)
				}
			});
		});
		
	}
}


exports.load = function (map, variables, callback) {
	loadObject("object", map, variables)(function (error, result) {
		callback(error, result.object)
	});
}
