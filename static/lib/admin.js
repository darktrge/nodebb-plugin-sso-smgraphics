define('admin/plugins/sso-smgraphics', ['settings'], function(Settings) {
	'use strict';
	/* globals $, app, socket, require */

	var ACP = {};
	ACP.init = function() {
		Settings.load('sso-smgraphics', $('.sso-smgraphics-settings'));

		$('#save').on('click', function() {
			console.log('save clicked inside the bugger!!!')
			Settings.save('sso-smgraphics', $('.sso-smgraphics-settings'), function() {
				console.log('attempting to save smgraphics settings')
				app.alert({
					type: 'success',
					alert_id: 'sso-smgraphics-saved',
					title: 'Settings Saved',
					message: 'Please reload your NodeBB to apply these settings',
					clickfn: function() {
						socket.emit('admin.reload');
					}
				});
			});
		});
	};

	return ACP;
});