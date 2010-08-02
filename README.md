Redis2JSON
==========

Redis2JSON is a NodeJS library that enabled you easily load data from Redis database in parallel and map it into JavaScript object.

Usage
-----
Just add `var redis2json = require("./lib/redis2json")` and set connection to Redis database with `redis2json.redis = redis;`

Examples
--------

Let say we have a Facebook-like NodeJS application and we use these keys:

- user:{userId}:username
- posts - *list of all posts*
- post:{postId}:text - *text in the post*
- post:{postId}:created - *date of submitting the post*
- post:{postId}:author - *ID of author*
- post:{postId}:comments - *list of comment IDs*


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


### More examples
... coming soon ...


License
-------
Released under MIT License. Enjoy and Fork!