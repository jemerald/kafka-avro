/**
 * @fileOverview Wrapper for node-rdkafka Consumer Ctor, a mixin.
 */
var Transform = require('stream').Transform;

var Promise = require('bluebird');
var cip = require('cip');
var kafka = require('node-rdkafka');

/**
 * Wrapper for node-rdkafka Consumer Ctor, a mixin.
 *
 * @constructor
 */
var Consumer = module.exports = cip.extend();

/**
 * The wrapper of the node-rdkafka package Consumer Ctor.
 *
 * @param {Object} opts Consumer general options.
 * @see https://github.com/edenhill/librdkafka/blob/2213fb29f98a7a73f22da21ef85e0783f6fd67c4/CONFIGURATION.md
 * @return {Promise(kafka.Consumer)} A Promise with the consumer.
 */
Consumer.prototype.getConsumer = Promise.method(function (topicName, opts) {
  if (!opts['metadata.broker.list']) {
    opts['metadata.broker.list'] = this.kafkaBrokerUrl;
  }

  console.log('KafkaAvro :: Starting Consumer with opts:', opts);

  var consumer = new kafka.KafkaConsumer(opts);

  consumer.on('event.log', function(log) {
    console.log('node-rdkafka log:', log);
  });

  // hack node-rdkafka
  consumer.__kafkaAvro_getReadStream = consumer.getReadStream;
  consumer.getReadStream = this._getReadStreamWrapper.bind(this, consumer);

  consumer.__kafkaAvro_on = consumer.on;
  consumer.on = this._onWrapper.bind(this, consumer);

  return new Promise(function(resolve) {
    consumer.on('ready', function() {
      resolve(consumer);
    });

    consumer.connect();
  });
});

/**
 * The node-rdkafka getReadStream method wrapper, will deserialize
 * the incoming message using the existing schemas.
 *
 * @param {kafka.KafkaConsumer} consumerInstance node-rdkafka instance.
 * @param {string} topic Topic to produce on.
 * @param {Object=} opts Stream options.
 * @return {Stream} A Stream.
 */
Consumer.prototype._getReadStreamWrapper = function (consumerInstance, topic,
  opts) {

  if (!this.valueSchemas[topic]) {
    // topic not found in schemas, bail early
    return consumerInstance.__kafkaAvro_getReadStream(topic, opts);
  }

  var stream = consumerInstance.__kafkaAvro_getReadStream(topic, opts);

  return stream
    .pipe(new Transform({
      objectMode: true,
      transform: this._transformAvro.bind(this, topic),
    }));
};

/**
 * The node-rdkafka on method wrapper, will intercept "data" events and
 * deserialize the incoming message using the existing schemas.
 *
 * @param {kafka.KafkaConsumer} consumerInstance node-rdkafka instance.
 * @param {string} eventName the name to listen for events on.
 * @param {Function} cb Event callback.
 * @private
 */
Consumer.prototype._onWrapper = function (consumerInstance, eventName, cb) {
  if (eventName !== 'data') {
    return consumerInstance.__kafkaAvro_on(eventName, cb);
  }

  consumerInstance.__kafkaAvro_on('data', function(message) {
    if (!this.valueSchemas[message.topic]) {
      console.log('KafkaAvro :: Warning, consumer did not find topic on SR:',
        message.topic);
      message.parsed = JSON.parse(message.toString('utf-8'));

      cb(message);
      return;
    }

    message.parsed = this.valueSchemas[message.topic].fromBuffer(message.value);

    cb(message);
  }.bind(this));
};


Consumer.prototype._transformAvro = function (topicName, data, encoding, callback) {
  if (!this.valueSchemas[topicName]) {
    console.log('KafkaAvro :: Warning, consumer did not find topic on SR:',
      topicName);
    data.parsed = JSON.parse(data.toString('utf-8'));

    callback(null, data);
    return;
  }
  data.parsed = this.valueSchemas[topicName].fromBuffer(data.value);
  callback(null, data);
};