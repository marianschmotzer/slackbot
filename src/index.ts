/*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
           ______     ______     ______   __  __     __     ______
          /\  == \   /\  __ \   /\__  _\ /\ \/ /    /\ \   /\__  _\
          \ \  __<   \ \ \/\ \  \/_/\ \/ \ \  _"-.  \ \ \  \/_/\ \/
           \ \_____\  \ \_____\    \ \_\  \ \_\ \_\  \ \_\    \ \_\
            \/_____/   \/_____/     \/_/   \/_/\/_/   \/_/     \/_/


This is a sample Slack Button application that adds a bot to one or many slack teams.

# RUN THE APP:
  Create a Slack app. Make sure to configure the bot user!
    -> https://api.slack.com/applications/new
    -> Add the Redirect URI: http://localhost:3000/oauth
  Run your bot from the command line:
    clientId=<my client id> clientSecret=<my client secret> port=3000 node slackbutton_bot.js
# USE THE APP
  Add the app to your Slack by visiting the login page:
    -> http://localhost:3000/login
  After you've added the app, try talking to your bot!
# EXTEND THE APP:
  Botkit has many features for building cool and useful bots!
  Read all about it here:
    -> http://howdy.ai/botkit
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~*/

/* Uses the slack button feature to offer a real time bot to multiple teams */
const Botkit = require('botkit');
const Storage = require('./lib/Storage');
import { registerActions } from './lib/actions';
import { keepAlive } from './helper/heroku';
import { webhookMiddleware } from './lib/actions/hooks';
import { EnvironmentWatcher } from "./lib/EnvironmentWatcher";
import config from './lib/config';

if (!process.env.clientId || !process.env.clientSecret || !process.env.redirectUri || !process.env.PORT || !process.env.REDIS_URL) {
    console.log(process.env);
    throw 'Error: Specify clientId clientSecret redirectUri in environment \n\n' + JSON.stringify(process.env);
    // process.exit(1);
}


const botframework_config = {
    // json_file_store: './db_slackbutton_bot/', // use for local, will save stuff on local disc
    storage: Storage(process.env.REDIS_URL)
    // rtm_receive_messages: false, // disable rtm_receive_messages if you enable events api
}
const slack_config = {
    clientId: process.env.clientId,
    clientSecret: process.env.clientSecret,
    redirectUri: process.env.redirectUri,
    scopes: ['bot'],
}

// just a simple way to make sure we don't
// connect to the RTM twice for the same team
var _bots = {};
function trackBot(bot) {
    _bots[bot.config.token] = bot;
}

const controller = Botkit.slackbot(botframework_config).configureSlackApp(slack_config);

controller.setupWebserver(process.env.PORT, function (err, webserver) {

    webserver.get('/ping', (req, res) => res.send('pong'));

    controller.createWebhookEndpoints(controller.webserver);
    controller.createOauthEndpoints(controller.webserver, function (err, req, res) {
        if (err) {
            res.status(500).send('ERROR: ' + err);
        } else {
            res.send('Success!');
        }
    });

    /*
    webserver.get('/allkeys', function (req, res) {
        const BaseStorage = require('./lib/Storage/BaseStorage');
        const store = new BaseStorage(process.env.REDIS_URL);
        return store.allAsMap()
            .then(allValues => {

                const body = JSON.stringify(allValues, null, 2);
                res.end(body);
            })
            .finally(() => store.kill());
    });
    */

    webserver.get('/hooks/:user/:hook', (req, res) => webhookMiddleware((req.params.user + '/' + req.params.hook), _bots, req, res));
});




controller.on('create_bot', function (bot, config) {

    if (_bots[bot.config.token]) {
        // already online! do nothing.
    } else {
        bot.startRTM(function (err) {

            if (!err) {
                trackBot(bot);
            }

            bot.startPrivateConversation({ user: config.createdBy }, function (err, convo) {
                if (err) {
                    console.log(err);
                } else {
                    convo.say('I am a bot that has just joined your team');
                    convo.say('You must now /invite me to a channel so that I can be of use!');
                }
            });

        });
    }

});


// Handle events related to the websocket connection to Slack
controller.on('rtm_open', function (bot) {
  console.log('** The RTM api just connected!');

  if (config.isDevelopmentMode) {
    return;
  }

  bot.say(
    {
      text: 'hi',
      channel: '#fsm_build_server' // a valid slack channel, group, mpim, or im ID
    }
  );

  EnvironmentWatcher.getEventStream()
    .forEach(streamEvent => bot.say(
      {
        text: streamEvent.msg,
        channel: '#fsm_build_server'
      }
    ))

});

controller.on('rtm_close', function (bot) {
  console.log('** The RTM api just closed');
  // you may want to attempt to re-open

  bot.say(
    {
      text: 'cu',
      channel: '#fsm_build_server' // a valid slack channel, group, mpim, or im ID
    }
  );
});


// register all actions
registerActions(controller);


controller.storage.teams.all(function (err, teams) {

    if (err) {
        console.error("NO Teams found to join, may have to re-login");
        teams = [];
    }

    // connect all teams with bots up to slack!
    for (var t in teams) {
        if (teams[t].bot) {
            controller.spawn(teams[t]).startRTM(function (err, bot) {
                if (err) {
                    console.log('Error connecting bot to Slack:', err);
                } else {
                    trackBot(bot);
                }
            });
        }
    }

});

// self ping
// keepAlive();
