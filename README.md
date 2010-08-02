Redis2JSON
==========

Redis2JSON is a NodeJS library that enables you easily load data from Redis database in parallel and map it into JavaScript object.

Usage
-----
Download and add to your code require statement and set connection to Redis. Then you are ready to load data.

	var sys = require("sys"),
		redislib = require("./lib/redis-client"),
		redis = redislib.createClient(),
		redis2json = require("./lib/redis2json");

	redis2json.redis = redis;
	
	redis2json.load(map, variables, callback);
	

Examples
--------

Let say we have a Facebook-like application and we use these keys in Redis database:

- User related keys:
	- user:{userId}:username - *user's username*
- Posts related keys:
	- posts - *list of all posts*
	- post:{postId}:text - *text in the post*
	- post:{postId}:created - *date of submitting the post*
	- post:{postId}:author - *ID of author*
	- post:{postId}:comments - *list of comment IDs*
- Comments related keys:
	- comment:{commentId}:text - *text in the comment*
	- comment:{commentId}:created - *date of submitting the comment*
	- comment:{commentId}:author - *ID of author*


### Loading a single post
	
	var map = {
		text: "post:{postId}:text",
		created: "post:{postId}:created"
	}

	var variables = {
		postId: 1
	}
	
	redis2json.load(map, variables, function (error, result) {
		sys.debug("Post with ID 1: " + sys.inspect(result));
	});

Result will look like:

	{
		text: 'dolore laudantium quia veniam cumque sed repudiandae',
		created: 'Mon Jul 26 2010 21:58:22 GMT+0200 (CEST)'
	}

Redis2JSON iterated over all properties of `map`, filled variables in properties values (strings in curly braces) and did `redis.get` with that value. Fields `text` and `created` were loaded in parallel.

### Static fields

Sometime we don't want to load all object properties from Redis or we already loaded it. For this case you can use *static* fields that are not loaded from Redis. All you need to do is prepend colon.

	var map = {
		postId: ":{postId}",
		text: "post:{postId}:text",
		created: "post:{postId}:created"
	}

	var variables = {
		postId: 1
	}
	
	redis2json.load(map, variables, function (error, result) {
		sys.debug("Post with ID 1: " + sys.inspect(result));
	});

Result will look like:

	{
		postId: '1',
		text: 'dolore laudantium quia veniam cumque sed repudiandae',
		created: 'Mon Jul 26 2010 21:58:22 GMT+0200 (CEST)'
	}

### Variables

Keys you load from Redis usually (or almost always) contains some ID or other variable data. As you noticed in examples above, when you want to load some object you also submit an object with list of variables. This is useful when you know which object you want to load. Sometimes you don't know what other object IDs you need.

From examples above, we are loading post #1. We also want to load author's ID. Just declare `$authorIdVariable` field in `map`. The dollar prefix identifies new variables that can be used later. These variables won't be in resulting object.

	var map = {
		postId: ":{postId}",
		text: "post:{postId}:text",
		created: "post:{postId}:created",
		$authorIdVariable: "post:{postId}:author",
		authorId: ":{authorIdVariable}"
	}

Result will look like:

	{
		postId: '1',
		text: 'dolore laudantium quia veniam cumque sed repudiandae',
		created: 'Mon Jul 26 2010 21:58:22 GMT+0200 (CEST)',
		authorId: '1'
	}

### Loading nested objects

Now we need to load also author of the post and we don't want to use a flat object structure, we want author to be nested in post object.

	var map = {
		postId: ":{postId}",
		text: "post:{postId}:text",
		created: "post:{postId}:created",
		$authorId: "post:{postId}:author",
		author: {
			authorId: ":{authorId}",
			username: "user:{authorId}:username"
		}
	}

Will result in object: 

	{
		postId: '1',
		text: 'dolore laudantium quia veniam cumque sed repudiandae',
		created: 'Mon Jul 26 2010 21:58:22 GMT+0200 (CEST)',
		author: {
			authorId: '1',
			username: 'igo'
		}
	}

### Loading arrays

All posts can have comments. Loading arrays is also possible, currently it's possible only to load array of objects. To load arrays just define some property as array (in this example `comments`) and also define *iteration* property with same name but with two dollar prefix (in example `$$comments`). Iteration property is an object with keys, that tells Redis2JSON how to load and iterate over array. Properties are:

- **variable**: name of variable where current value of iterated array will be stored
- **cmd**: Redis command used to retrieve values
- **key**: name of key in database where array is stored
- **args**: other parameters that Redis function requires (usually a range)

Example:

	var map = {
		text: "post:{postId}:text",
		created: "post:{postId}:created",
		$$comments: { variable: "commentId", cmd: "lrange", key: "post:{postId}:comments", args: [0, 20] },
		comments: [{
			text: "comment:{commentId}:text",
			created: "comment:{commentId}:create",
		}]
	}

	var variables = {
		postId: 1
	}

	redis2json.load(map, variables, function (error, result) {
		sys.debug("Post ID 1 with comments: " + sys.inspect(result));
	});

Result:

	{
		postId: '1',
		text: 'dolore laudantium quia veniam cumque sed repudiandae',
		created: 'Mon Jul 26 2010 21:58:22 GMT+0200 (CEST)',
		comments: [{
				text: 'voluptatum minima distinctio consequatur quia',
				created: 'Mon Jul 26 2010 21:58:22 GMT+0200 (CEST)'
			}, {
				text: 'dolores et ea excepturi et dolor quibusdam',
				created: 'Mon Jul 26 2010 21:58:22 GMT+0200 (CEST)'
		}]
	}


### Full feature example
Now combine it all together and load first 20 posts with authors and comments and comment authors:

	var map = {
		$$posts: { variable: "postId", cmd: "lrange", key: "posts", args: [0, 20] },
		posts: [{
			postId: ":{postId}",
		    text: "post:{postId}:text",
		    created: "post:{postId}:created",
			$authorId: "post:{postId}:author",
			author: {
				authorId: ":{authorId}",
				username: "user:{authorId}:username"
			},
			$$comments: { variable: "commentId", cmd: "lrange", key: "post:{postId}:comments", args: [0, 1000] },
			comments: [{
				commentId: ":{commentId}",
				text: "comment:{commentId}:text",
				created: "comment:{commentId}:create",
				$commentAuthorId: "comment:{commentId}:author",
				author: {
					authorId: ":{commentAuthorId}",
					username: "user:{commentAuthorId}:username"
				}
			}]
		}]
	}
	
	redis2json.load(map, {}, function (error, result) {
	    sys.debug("Posts with comments: " + sys.inspect(result, false, 10));
	});


License
-------
Released under MIT License. Enjoy and Fork!