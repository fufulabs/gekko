/*

  Gekko is a Bitcoin trading bot for popular Bitcoin exchanges written 
  in node, it features multiple trading methods using technical analysis.

  Disclaimer:

  USE AT YOUR OWN RISK!

  The author of this project is NOT responsible for any damage or loss caused 
  by this software. There can be bugs and the bot may not perform as expected 
  or specified. Please consider testing it first with paper trading / 
  backtesting on historical data. Also look at the code to see what how 
  it is working.

*/

var util = require(__dirname + '/core/util');
var dirs = util.dirs();

var _ = require('lodash');
var async = require('async');

var log = require(dirs.core + 'log');

// make sure the current node version is recent enough
if(!util.recentNode())
  util.die([
    'Your local version of Node.js is too old. ',
    'You have ',
    process.version,
    ' and you need atleast ',
    util.getRequiredNodeVersion()
  ].join(''));

var config = util.getConfig();
var mode = util.gekkoMode();

if(
  config.trader.enabled &&
  !config['I understand that Gekko only automates MY OWN trading strategies']
)
  util.die('Do you understand what Gekko will do with your money? Read this first:\n\nhttps://github.com/askmike/gekko/issues/201');

log.info('Gekko v' + util.getVersion(), 'started');
log.info('I\'m gonna make you rich, Bud Fox.', '\n\n');

// load either realtime or backtest market
var Market = require(dirs.core + mode + 'Market');

var GekkoStream = require(dirs.core + 'gekkoStream');

// all plugins
var plugins = [];
// all emitting plugins
var emitters = {};
// all plugins interested in candles
var candleConsumers = [];

// utility to check and load plugins.
var pluginHelper = require(dirs.core + 'pluginUtil');

// meta information about every plugin that tells Gekko
// something about every available plugin
var pluginParameters = require(dirs.gekko + 'plugins');

// Instantiate each enabled plugin
var loadPlugins = function(next) {

  // load all plugins
  async.mapSeries(
    pluginParameters,
    pluginHelper.load,
    function(error, _plugins) {
      if(error)
        return util.die(error, true);

      plugins = _.compact(_plugins);
      next();
    }
  );
};

// Some plugins emit their own events, store
// a reference to those plugins.
var referenceEmitters = function(next) {

  _.each(plugins, function(plugin) {
    if(plugin.meta.emits)
      emitters[plugin.meta.slug] = plugin;
  });

  next();
}

// Subscribe all plugins to other emitting plugins
var subscribePlugins = function(next) {
  var subscriptions = require(dirs.gekko + 'subscriptions');

  // events broadcasted by plugins
  var pluginSubscriptions = _.filter(
    subscriptions,
    function(sub) {
      return sub.emitter !== 'market';
    }
  );

  // subscribe interested plugins to
  // emitting plugins
  _.each(plugins, function(plugin) {
    _.each(pluginSubscriptions, function(sub) {
      if(_.has(plugin, sub.handler)) {

        // if a plugin wants to listen
        // to something disabled
        if(!emitters[sub.emitter]) {
          return log.warn([
            plugin.meta.name,
            'wanted to listen to the',
            sub.emitter + ',',
            'however the',
            sub.emitter,
            'is disabled.'
          ].join(' '));
        }

        // attach handler
        emitters[sub.emitter]
          .on(sub.event,
            plugin[
              sub.handler
            ])
      }

    });
  });

  // events broadcasted by the market
  var marketSubscriptions = _.filter(
    subscriptions,
    {emitter: 'market'}
  );

  // subscribe plugins to the market
  _.each(plugins, function(plugin) {
    _.each(marketSubscriptions, function(sub) {

      // for now, only subscribe to candles
      if(sub.event !== 'candle')
        return;

      if(_.has(plugin, sub.handler))
        candleConsumers.push(plugin);

    });
  });

  next();
}

log.info('Setting up Gekko in', mode, 'mode');
log.info('');

async.series(
  [
    loadPlugins,
    referenceEmitters,
    subscribePlugins
  ],
  function() {
    var market = new Market(config);
    var gekko = new GekkoStream(candleConsumers);

    market
      .pipe(gekko)

      // convert JS objects to JSON string
      // .pipe(new require('stringify-stream')())
      // output to standard out
      // .pipe(process.stdout);

    market.on('end', gekko.finalize);
  }
);