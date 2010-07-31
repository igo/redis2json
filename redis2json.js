var sys = require('sys'),
	async = require('./async'),
	redislib = require("./redis-client"),
	redis = redislib.createClient();

sys.debug("Starting");

function fillVariables(text, variables) {
	var newText = text;
	for(var prop in variables) {
		// sys.debug("EXPANDING: " + prop);
		if(variables.hasOwnProperty(prop)) {
			// sys.debug("EXPANDING replacing: " + prop + " with " + variables[prop]);
			newText = newText.replace("{" + prop + "}", variables[prop]);
		}
	}
	return newText;
}


var map = {
	text: "post:{postId}:text",
	created: "post:{postId}:created",
	$authorId: "post:{postId}:author",
	author: {
		username: "user:{authorId}:username",
		password: "user:{authorId}:password"
	},
	// $$comments: ["commentId", "lrange", "post:{postId}:comments", 1, 20],
	$$comments: { variable: "commentId", cmd: "lrange", key: "post:{postId}:comments", args: [1, 20] },
	comments: [
		{
			text: "comment:{commentId}:text",
			created: "comment:{commentId}:create",
			$commentAuthorId: "comment:{commentId}:author",
			author: {
				username: "user:{commentAuthorId}:username",
				password: "user:{commentAuthorId}:password"
			}
		}
	]
}

map = {
	$$posts: { variable: "postId", cmd: "lrange", key: "posts", args: [1, 30] },
	posts: [ map ]
}

var variables = {
	// postId: 1
}


function loadValue(key, redisKey, variables) {
	return function (callback) {
		var expandedRedisKey = fillVariables(redisKey, variables);
		sys.debug("LOAD VALUE " + redisKey + " to " + expandedRedisKey + " with: " + sys.inspect(variables));
		redis.get(expandedRedisKey, function (error, value) {
			// sys.debug("REDIS LOADED key " + expandedRedisKey + ": " + value);
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

function loadArray(key, map, variables, arrayCommand) {
	return function (callback) {
		sys.debug("LOAD ARRAY " + key + " ; cmd: " + sys.inspect(arrayCommand));
		var expandedRedisKey = fillVariables(arrayCommand.key, variables);
		var args = arrayCommand.args || [];
		args.unshift(expandedRedisKey);
		args.push(function (error, array) {
			if (array) { // array is not empty
				redislib.convertMultiBulkBuffersToUTF8Strings(array);
				sys.debug("REDIS ARRAY LOADED " + sys.inspect(array));
				var actions = [];
				for (var i=0; i < array.length; i++) {
					variables[arrayCommand.variable] = array[i];
					sys.debug("LOAD ARRAY vars: " + JSON.stringify(variables));

					// collect actions that will be loaded
					for (var prop in map) {
						if(map.hasOwnProperty(prop) && prop.substr(0, 1) != "$") {
							sys.debug("Property: " + prop + ", type: " + typeof map[prop]);
							if (typeof map[prop] === "string") {
								actions.push(loadValue(null, map[prop], variables));
							} else if (typeof map[prop] === "object" && !Array.isArray(map[prop])) {
								actions.push(loadObject(null, map[prop], variables));
							} else if (typeof map[prop] === "object" && Array.isArray(map[prop])) {
								actions.push(loadArray(null, map[prop], variables, map["$$" + prop]));
							} else {
								sys.debug("Property: " + prop + ", type: " + typeof map[prop]);
							}
						}
					}
				}
				async.parallel(actions, function (error, results) {
					// sys.debug("ARRAY LOADED Result: " + sys.inspect(results));
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
		redis[arrayCommand.cmd].apply(redis, args);
		// redis.lrange(redis, args);
	}
}

function loadObject(key, map, variables) {
	return function (callback) {
		sys.debug("LOAD OBJECT: " + key + "; " + JSON.stringify(variables) + "; " + sys.inspect(map));
		var actions = [];
		var newVariablesActions = [];
		
		// collect actions that load new variables
		for (var prop in map) {
			if(map.hasOwnProperty(prop) && prop.substr(0, 1) == "$") {
				// sys.debug("Property: " + prop + ", type: " + typeof map[prop]);
				if (typeof map[prop] === "string") {
					newVariablesActions.push(loadValue(prop.substr(1), map[prop], variables));
				}
			}
		}
		
		// load variables
		// sys.debug("load variables: Executing parallel: " + sys.inspect(newVariablesActions));
		async.parallel(newVariablesActions, function (error, results) {
			for (var i=0; i < results.length; i++) {
				for (var prop in results[i]) {
					variables[prop] = results[i][prop];
				}
			};
			// sys.debug("VARIABLES LOADED Result: " + sys.inspect(variables));
			
			// collect actions that will be loaded
			for (var prop in map) {
				if(map.hasOwnProperty(prop) && prop.substr(0, 1) != "$") {
					// sys.debug("Property: " + prop + ", type: " + typeof map[prop]);
					if (typeof map[prop] === "string") {
						actions.push(loadValue(prop, map[prop], variables));
					} else if (typeof map[prop] === "object" && !Array.isArray(map[prop])) {
						actions.push(loadObject(prop, map[prop], variables));
					} else if (typeof map[prop] === "object" && Array.isArray(map[prop])) {
						actions.push(loadArray(prop, map[prop], variables, map["$$" + prop]));
					} else {
						// sys.debug("Property: " + prop + ", type: " + typeof map[prop]);
					}
				}
			}

			// load values, objects, arrays
			// sys.debug("Executing parallel: " + sys.inspect(actions));
			async.parallel(actions, function (error, results) {
				var o = {};
				for (var i=0; i < results.length; i++) {
					for (var prop in results[i]) {
						o[prop] = results[i][prop];
					}
				};
				// sys.debug("OBJECT LOADED Result: " + sys.inspect(o));
				if (key) {
					var o2 = {};
					o2[key] = o;
					callback(error, o2);
				} else {
					callback(error, o)
				}
			});
			// callback(error, o2);
		});
		
	}
}

function load(map, variables, callback) {
	loadObject("object", map, variables)(function (error, result) {
		callback(error, result.object)
	});
}

load(map, variables, function (error, result) {
	sys.debug("LOADED Result: " + sys.inspect(result) + "ERROR" + sys.inspect(error));
	sys.debug("LOADED COMMENTS Result: " + sys.inspect(result.comments) + "ERROR" + sys.inspect(error));
	// sys.debug("LOADED FINALE VARIABLES: " + sys.inspect(variables) + "MAP" + sys.inspect(map));
	sys.debug("LOADED SERIALIZED Result: " + JSON.stringify(result));
});



sys.debug(sys.inspect(map));


sys.debug("Done");

