(function(module) {
	"use strict";
	/*
	 Welcome to the SSO OAuth plugin! If you're inspecting this code, you're probably looking to
	 hook up NodeBB with your existing OAuth endpoint.

	 Step 1: Fill in the "constants" section below with the requisite informaton. Either the "oauth"
	 or "oauth2" section needs to be filled, depending on what you set "type" to.

	 Step 2: Give it a whirl. If you see the congrats message, you're doing well so far!

	 Step 3: Customise the `parseUserReturn` method to normalise your user route's data return into
	 a format accepted by NodeBB. Instructions are provided there. (Line 137)

	 Step 4: If all goes well, you'll be able to login/register via your OAuth endpoint credentials.
	 */

	var User = module.parent.require('./user'),
		Groups = module.parent.require('./groups'),
		meta = module.parent.require('./meta'),
		db = module.parent.require('../src/database'),
		passport = module.parent.require('passport'),
		fs = module.parent.require('fs'),
		path = module.parent.require('path'),
		nconf = module.parent.require('nconf'),
		winston = module.parent.require('winston'),
		async = module.parent.require('async'),

		//constants = Object.freeze({
		constants = Object({
			type: 'oauth2',	// 'oauth2' is the only supported strategy atm
			name: 'smgraphics',	// Something unique to your OAuth provider in lowercase, like "github", or "nodebb"
			oauth2: {
				clientID: '',
				clientSecret: '',
				authorizationURL: 'https://pgoauth2.smithmicro.com/dialog/authorize',
				tokenURL: 'http://10.128.146.71:3001/oauth/token'
			},
			userRoute: 'http://10.128.146.71:3001/api/userinfo',	// This is the address to your app's "user profile" API endpoint (expects JSON)
			'admin': {
				'route': '/plugins/sso-smgraphics',
				'icon': 'fa-smgraphics-square'
			}
		}),
		configOk = false,
		OAuth = {}, passportOAuth, opts;

	if (!constants.name) {
		winston.error('[sso-oauth] Please specify a name for your OAuth provider (library.js:32)');
	} else if (!constants.oauth2) {
		winston.error('[sso-oauth] Fatal error Oauth2 strategy missing!!!');
	} else if (!constants.userRoute) {
		winston.error('[sso-oauth] User Route required (library.js:39)');
	} else {
		configOk = true;
	}

	OAuth.init = function (data, callback) {
		function render(req, res, next) {
			res.render('admin/plugins/sso-smgraphics', {});
		}

		data.router.get('/admin/plugins/sso-smgraphics', data.middleware.admin.buildHeader, render);
		data.router.get('/api/admin/plugins/sso-smgraphics', render);

		callback();
	};

	OAuth.addMenuItem = function(custom_header, callback) {
		custom_header.authentication.push({
			"route": constants.admin.route,
			"icon": constants.admin.icon,
			"name": constants.name
		});

		callback(null, custom_header);
	}

	OAuth.getStrategy = function(strategies, callback) {
		meta.settings.get('sso-smgraphics', function(err, settings) {
			if (err) {
				callback(new Error('Error getting smgraphics oauth configuration'));
				return;
			}
			if (!settings['id'] || !settings['secret']) {
				callback(new Error('OAuth Configuration is invalid, please check id and secret'));
				return;
			}
			constants.oauth2.clientID = settings.id;
			constants.oauth2.clientSecret = settings.secret;

			if (configOk) {
				passportOAuth = require('passport-oauth')['OAuth2Strategy'];
				// OAuth 2 options
				opts = constants.oauth2;
				opts.callbackURL = nconf.get('url') + '/auth/' + constants.name + '/callback';

				passportOAuth.Strategy.prototype.userProfile = function(accessToken, done) {
					this._oauth2.get(constants.userRoute, accessToken, function(err, body, res) {
						if (err) { return done(new InternalOAuthError('failed to fetch user profile', err)); }

						try {
							var json = JSON.parse(body);
							OAuth.parseUserReturn(json, function(err, profile) {
								if (err) return done(err);
								profile.provider = constants.name;
								done(null, profile);
							});
						} catch(e) {
							done(e);
						}
					});
				};

				passport.use(constants.name, new passportOAuth(opts, function(token, secret, profile, done) {
					OAuth.login({
						oAuthid: profile.id,
						handle: profile.displayName,
						email: profile.emails[0].value,
						isAdmin: profile.isAdmin
					}, function(err, user) {
						if (err) {
							return done(err);
						}
						done(null, user);
					});
				}));

				strategies.push({
					name: constants.name,
					url: '/auth/' + constants.name,
					callbackURL: '/auth/' + constants.name + '/callback',
					icon: 'fa-check-square',
					scope: (constants.scope || '').split(',')
				});

				callback(null, strategies);
			} else {
				callback(new Error('OAuth Configuration is invalid'));
			}
		});


	};

	OAuth.parseUserReturn = function(data, callback) {
		//console.log('data in parseUserReturn')
		//console.log(data)
		// Alter this section to include whatever data is necessary
		// NodeBB *requires* the following: id, displayName, emails.
		// Everything else is optional.

		// Find out what is available by uncommenting this line:
		// console.log(data);

		var profile = {};
		profile.id = data.user_id;
		profile.username = data.username;
		profile.displayName = data.name+' '+data.last_name;
		profile.emails = [{ value: data.email }];

		// Do you want to automatically make somebody an admin? This line might help you do that...
		// profile.isAdmin = data.isAdmin ? true : false;
		profile.isAdmin = false;

		// Delete or comment out the next TWO (2) lines when you are ready to proceed
		//process.stdout.write('===\nAt this point, you\'ll need to customise the above section to id, displayName, and emails into the "profile" object.\n===');
		//return callback(new Error('Congrats! So far so good -- please see server log for details'));

		callback(null, profile);
	}

	OAuth.login = function(payload, callback) {
		OAuth.getUidByOAuthid(payload.oAuthid, function(err, uid) {

			if(err) {
				return callback(err);
			}

			if (uid !== null) {
				// Existing User
				callback(null, {
					uid: uid
				});
			} else {
				// New User
				var success = function(uid) {
					// Save provider-specific information to the user
					meta.settings.get('sso-smgraphics', function(err, settings) {
						//var autoConfirm = settings && settings['autoconfirm'] === "on" ? 1 : 0;
						//User.setUserField(uid, 'email:confirmed', autoConfirm);
						User.setUserField(uid, constants.name + 'Id', payload.oAuthid);
						db.setObjectField(constants.name + 'Id:uid', payload.oAuthid, uid);

						callback(null, {
							uid: uid
						});
					});
				};

				User.getUidByEmail(payload.email, function(err, uid) {
					if(err) {
						return callback(err);
					}

					if (!uid) {
						User.create({
							username: payload.handle,
							email: payload.email
						}, function(err, uid) {
							if(err) {
								return callback(err);
							}

							success(uid);
						});
					} else {
						success(uid); // Existing account -- merge
					}
				});
			}
		});
	};

	OAuth.getUidByOAuthid = function(oAuthid, callback) {
		db.getObjectField(constants.name + 'Id:uid', oAuthid, function(err, uid) {
			if (err) {
				return callback(err);
			}
			callback(null, uid);
		});
	};

	OAuth.deleteUserData = function(uid, callback) {
		async.waterfall([
			async.apply(User.getUserField, uid, constants.name + 'Id'),
			function(oAuthIdToDelete, next) {
				db.deleteObjectField(constants.name + 'Id:uid', oAuthIdToDelete, next);
			}
		], function(err) {
			if (err) {
				winston.error('[sso-smgraphics] Could not remove OAuthId data for uid ' + uid + '. Error: ' + err);
				return callback(err);
			}
			callback(null, uid);
		});
	};

	module.exports = OAuth;
}(module));