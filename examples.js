var sys = require("sys"),
	redislib = require("./lib/redis-client"),
	redis = redislib.createClient(),
	redis2json = require("./lib/redis2json");

redis2json.redis = redis;



var map = {
	postId: ":{postId}",

	text: "post:{postId}:text",
		created: "post:{postId}:created",
		$authorId: "post:{postId}:author",
		author: {
			authorId: ":{authorId}",
			username: "user:{authorId}:username",
			password: "user:{authorId}:password"
		},
			$$comments: ["commentId", "lrange", "post:{postId}:comments", 1, 20],

	$$comments: { variable: "commentId", cmd: "lrange", key: "post:{postId}:comments", args: [0, 20] },
		comments: [
							{
								commentId: ":{commentId}",
								text: "comment:{commentId}:text",
			
			created: "comment:{commentId}:create",
						$commentAuthorId: "comment:{commentId}:author",
						author: {
							authorId: ":{commentAuthorId}",
							username: "user:{commentAuthorId}:username",
							password: "user:{commentAuthorId}:password"
						}

		}
	]
}

map = {
	$$posts: { variable: "postId", cmd: "lrange", key: "posts", args: [0, 30] },
	posts: [ map ]
}


var variables = {
	postId: 1
}


redis2json.load(map, variables, function (error, object) {
	if (error) {
		sys.debug("LOADED ERROR: " + error + "; OBJ: " + sys.inspect(object, false, 10));
	} else {
		sys.debug("LOADED: " + sys.inspect(object, false, 10));
	}
});

