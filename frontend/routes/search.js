var config = require('../config');
var elasticsearch = require('elasticsearch');
var cassandra = require('cassandra-driver');
var cassandra_client = new cassandra.Client({
    contactPoints: config.cassandra.contactPoints,
    keyspace: config.cassandra.keyspace
});
cassandra_client.connect(function(err, result) {
    if (err) {
        console.log('cassandra failed to connect: %s', err);
    } else {
        console.log('cassandra connected');
    }
});


var es_client = new elasticsearch.Client({
    host: config.es.host,
    // log: 'trace'
});
es_client.ping({
    requestTimeout: 10000,
}, function(error) {
    if (error) {
        console.error('elasticsearch cluster is down!');
    } else {
        console.log('elasticsearch is all well');
    }
});


var registerQuery = function(topic, cb) {
    /*es_client.indices.create({
        index: 'post_percolators',
        body: {
            "mappings": {
                "doctype": {
                    "properties": {
                        "post": {
                            "type": "text"
                        }
                    }
                },
                "queries": {
                    "properties": {
                        "query": {
                            "type": "percolator"
                        }
                    }
                }
            }
        },
        ignore: [404]
    }).then(function(body) {
        // since we told the client to ignore 404 errors, the
        // promise is resolved even if the index already exists
        console.log("Created 'post_percolators' in es");
    }, function(error) {});*/

    es_client.index({
        index: 'post_percolators',
        type: 'queries',
        id: topic,
        body: {
            "query": {
                "match": {
                    "post": topic
                }
            }
        },
    }).then(function(resp) {
        var hits = resp.hits.hits;
        console.log('es search result: ', hits);
    }, function(err) {
        console.trace(err.message);
    });
};



module.exports = function(app) {

    app.get("/search_docs/:doc_ids", function(request, response) {
        var doc_ids = request.params.doc_ids.split(",");
        cassandra_client.execute('SELECT * FROM docs WHERE doc_id IN ?', [doc_ids], function(error, result) {
            if (error) {
                response.status(404).send({
                    'msg': error,
                });
            } else {
                response.json({
                    'response': result.rows,
                });
            }
        });
    });

    app.get("/search/:topic/:lasttime", function(request, response) {
        var topic = request.params.topic;
        var lasttime = request.params.lasttime;
        var query = 'SELECT query, created_utc, doc_id, subreddit FROM posts WHERE query = ? ORDER BY created_utc ASC LIMIT 10;';
        var params = [topic];
        if (lasttime !== 'unknown') {
            query = 'SELECT query, created_utc, doc_id, subreddit FROM posts WHERE query = ? AND created_utc > ? ORDER BY created_utc ASC LIMIT 10;';
            params = [topic, lasttime];
        } else {
            // First time searching for this topic, we register it into ES
            registerQuery(topic, function(topic) {});
        }

        console.log('Searching for "' + topic + '"...');
        cassandra_client.execute(query, params, {
            prepare: true
        }, function(error, result) {
            if (error) {
                response.status(404).send({
                    'msg': error,
                });
            } else {
                response.json({
                    'response': result.rows,
                });
            }
        });
    });
};
