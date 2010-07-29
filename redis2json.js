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
	$$posts: { variable: "postId", cmd: "lrange", key: "posts", args: [5, 10] },
	posts: [ map ]
}

var variables = {
	// postId: 1
}

/*

async.parallel([
    loadRedis("text", "post:2:text"),
    function(callback){
        setTimeout(function(){
            callback(null, 'two');
        }, 100);
    },
],
// optional callback
function(err, results){
    sys.debug("Result: " + sys.inspect(results));
});
 */
/*
async.waterfall([
    function(callback){
        callback(null, 'one', 'two');
    },
    function(arg1, arg2, callback){
        callback(null, 'three');
    },
    function(arg1, callback){
        // arg1 now equals 'three'
        callback(null, arg1);
    }
], 	function(err, results){
	    sys.debug("waterfall Result: " + sys.inspect(results));
});*/


function loadValue(key, redisKey, variables) {
	return function (callback) {
		var expandedRedisKey = fillVariables(redisKey, variables);
		sys.debug("REDIS EXPANDED " + redisKey + " to " + expandedRedisKey + " with: " + sys.inspect(variables));
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
		// sys.debug("ARRAY LOADING " + sys.inspect(arrayCommand));
		var expandedRedisKey = fillVariables(arrayCommand.key, variables);
		var args = arrayCommand.args || [];
		args.unshift(expandedRedisKey);
		args.push(function (error, array) {
			array = array || []; // avoid errors if array is empty
			if (array) { // array is not empty
				redislib.convertMultiBulkBuffersToUTF8Strings(array);
				// sys.debug("ARRAY LOADED " + sys.inspect(array));
				for (var i=0; i < array.length; i++) {
					variables[arrayCommand.variable] = array[i];


					// collect actions that will be loaded
					var actions = [];
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
					async.parallel(actions, function (error, results) {
						sys.debug("ARRAY LOADED Result: " + sys.inspect(results));
						if (key) {
							var o = {};
							o[key] = results;
							callback(error, o);
						} else {
							callback(error, o)
						}
					});				
				}
			} else {
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
	// sys.debug("LOAD OBJECT: " + key + "; ");
	return function (callback) {
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
		sys.debug("load variables: Executing parallel: " + sys.inspect(newVariablesActions));
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
					sys.debug("Property: " + prop + ", type: " + typeof map[prop]);
					if (typeof map[prop] === "string") {
						actions.push(loadValue(prop, map[prop], variables));
					} else if (typeof map[prop] === "object" && !Array.isArray(map[prop])) {
						actions.push(loadObject(prop, map[prop], variables));
					} else if (typeof map[prop] === "object" && Array.isArray(map[prop])) {
						actions.push(loadArray(prop, map[prop], variables, map["$$" + prop]));
					} else {
						sys.debug("Property: " + prop + ", type: " + typeof map[prop]);
					}
				}
			}

			// load values, objects, arrays
			sys.debug("Executing parallel: " + sys.inspect(actions));
			async.parallel(actions, function (error, results) {
				var o = {};
				for (var i=0; i < results.length; i++) {
					for (var prop in results[i]) {
						o[prop] = results[i][prop];
					}
				};
				sys.debug("OBJECT LOADED Result: " + sys.inspect(o));
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
});



sys.debug(sys.inspect(map));



function loadRedisOld(key, redisKey) {
	return function(callback) {
		redis.get(redisKey, function (error, value) {
			
			sys.debug("redis loaded key " + redisKey + ": " + value);
			callback(value);
		});
	}
}

function loadRedis(key, redisKey) {
	return function(callback) {
		redis.get(redisKey, function (error, value) {
			sys.debug("redis loaded key " + redisKey + ": " + value);
			var o = {};
			o[key] = value;
			redislib.convertMultiBulkBuffersToUTF8Strings(o);
			callback(error, o);
		});
	}
}

// loadRedis("text", "post:2:text")(function(obj){
// 	sys.debug("OBJ: " + sys.inspect(obj));
// });


function loadString(key, redisKey, variables) {
	return function(callback) {
		return loadRedis(key, fillVariables(redisKey, variables))(callback);
	}
}

// loadString("text", "post:{postId}:text", {postId: 3})(function(obj){
// 	sys.debug("SSSSSS: " + sys.inspect(obj));
// });


function loadObject2(map, variables) {
	return function(callback) {
		var actions = [];
		for (var prop in map) {
			if (map.hasOwnProperty(prop)) {
				if (typeof map[prop] === "string") {
					actions.push(loadString(prop, map[prop], variables));
				}
			}
		}
		Do.parallel(actions)(function (values) {
			var object = {};
			var vars = {};
			for (var i=0; i < values.length; i++) {
				for (prop in values[i]) {
					if (prop.substr(0, 1) == "$") {
						vars[prop.substr(1)] = values[i][prop];
					} else {
						object[prop] = values[i][prop];
					}
					
				}
			};
			callback({object: object, vars: vars});
			// sys.debug("STRINGS: " + sys.inspect(obj));
		});
	}
}


function loadData(map, variables, callback) {
	var keys = [];
	var actions = [];
	
	var strings = [];
	for(var prop in map) {
		if(map.hasOwnProperty(prop)) {
			if (typeof map[prop] === "string") {
				strings.push();
				actions.push(loadRedis(prop, fillVariables(map[prop], variables)));
			}
		}
	}
	// loadStrings();
}

function nieco() {
	function load(op, key) {
		redis[op](key, function (error, value) {
			// sys.debug(key + ": " + value);
		});
	}
	
	var keys = [];
	var actions = [];
	var result = o || {};
	for(var prop in map) {
		if(map.hasOwnProperty(prop)) {
			if (typeof map[prop] === "string") {
				keys.push(prop);
				actions.push(loadRedis(prop, fillVariables(map[prop], variables)));
			} else if (typeof map[prop] === "object") {
				// loadData(map[prop], variables);
			}
		}
	}
	
	Do.parallel(actions)(function (values) {
		redislib.convertMultiBulkBuffersToUTF8Strings(values);
		sys.debug("Keys: " + sys.inspect(keys));
		sys.debug("Values: " + sys.inspect(values));
		for (var i=0; i < keys.length; i++) {
			sys.debug("$: " + keys[i].substr(0, 1));
			if (keys[i].substr(0, 1) == "$") {
				variables[keys[i].substr(1)] = values[i];
			} else {
				result[keys[i]] = values[i];
			}
		};
		
		sys.debug("Result: " + sys.inspect(result));
		sys.debug("Variables: " + sys.inspect(variables));



		for(var prop in map) {
			if(map.hasOwnProperty(prop)) {
				if (typeof map[prop] === "object") {
					result[prop] = {};
					loadData(map[prop], variables, result[prop]);
				}
			}
		}




	});
	
}

sys.debug("Done");

