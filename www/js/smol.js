var app = {

	httpd: null,
	data: null,
	//editing: false,

	config_defaults: {
		feature_flag_edit: true,
		feature_flag_search: true
	},

	data_defaults: {

		// Updates here should be mirrored in data.php

		id: 0,
		name: 'Untitled map',
		slug: null,
		authors: null,
		description: null,
		latitude: null,
		longitude: null,
		zoom: null,
		base: 'refill',
		options: {
			transit: false,
			refill_theme: "black",
			refill_detail: 10,
			refill_label: 5,
			walkabout_path: true,
			walkabout_bike: false,
			bubble_wrap_labels: "normal",
			recent_icons: [],
			default_icon: 'marker-stroked',
			default_color: '#8442D5'
		},
		authors: null,
		description: null,
		current: 1,
		venues: []
	},

	venue_defaults: {

		// Updates here should be mirrored in data.php

		id: 0,
		name: null,
		address: null,
		tags: null,
		url: null,
		description: null,
		icon: 'marker-stroked',
		color: '#8442D5',
		current: 1
	},

	map_marker_icon: L.divIcon({
		className: 'map-marker'
	}),

	init: function() {
		if (location.search.indexOf('print') !== -1) {
			$(document.body).addClass('print');
		}
		if (typeof cordova == 'object') {
			document.addEventListener('deviceready', app.ready, false);
		} else {
			app.ready();
			app.setup();
		}
	},

	ready: function() {
		$('#app').addClass('ready');
		app.start_httpd();
	},

	setup: function() {
		app.setup_data(function() {
			app.setup_config(function(wof) {
				console.log('map', app.data);
				console.log('config', app.config);
				if (app.data.id) {
					document.title = app.data.name;
					app.setup_map(wof);
					app.setup_menu();
				} else {
					app.setup_choose_map(wof);
				}
				app.setup_add_venue();
			});
			app.setup_map_details();
		});
		app.setup_screengrab();
	},

	error: function(msg) {
		console.error(msg);
	},

	start_httpd: function() {
		httpd = ( typeof cordova == 'object' && cordova.plugins && cordova.plugins.CorHttpd ) ? cordova.plugins.CorHttpd : null;
		if (httpd) {
			httpd.startServer({
				www_root: '.',
				port: 8080,
				localhost_only: false
			}, app.setup, app.error);
		}
	},

	setup_data: function(callback) {

		var slug_match = location.pathname.match(/\/([a-zA-Z0-9_-]+)/);
		if (slug_match) {
			// Load up the data from the server
			app.api_call('get_map', {
				slug: slug_match[1]
			}).then(function(rsp) {
				if (rsp.map) {
					app.data = app.normalize_data(rsp.map);
					localforage.setItem('map_' + app.data.id, rsp.map);
					localforage.setItem('map_id', rsp.map.id);
					callback();
				} else if (rsp.error) {
					console.error(rsp.error);
				} else {
					console.error('could not get_map ' + slug_match[1]);
				}
			});
		} else {
			app.data = app.data_defaults;
			callback();
		}
		/*

		disabling this for now

			// See if we have a map_id stored
			localforage.getItem('map_id').then(function(id) {
				// If yes, we are working from that map's data
				if (id && typeof id == 'number') {
					localforage.getItem('map_' + id).then(function(data) {
						if (data) {
							app.data = app.normalize_data(data);
						} else {
							console.error("could not load 'map_" + id + "' from localforage");
							app.data = app.data_defaults;
						}
						if (typeof callback == 'function') {
							callback();
						}
					});
				} else {
					// Otherwise, use the default
					app.data = app.data_defaults;
					if (typeof callback == 'function') {
						callback();
					}
				}
			});
		}*/
	},

	setup_map: function(wof) {

		if (app.map) {
			return;
		}

		var map = L.map('map', {
			zoomControl: false
		});
		app.map = map;
		map.setMinZoom(app.config.min_zoom);

		if ($(document.body).width() > 640 &&
		    ! $(document.body).hasClass('print')) {
			L.control.zoom({
				position: 'bottomleft'
			}).addTo(map);
			$('.leaflet-control-zoom-in').html('<span class="fa fa-plus"></span>');
			$('.leaflet-control-zoom-out').html('<span class="fa fa-minus"></span>');
			$('#map').addClass('has-zoom-controls');
		}

		slippymap.crosshairs.init(map);

		if (! $(document.body).hasClass('print')) {
			L.control.locate({
				position: 'bottomleft'
			}).addTo(map);

			L.control.addVenue({
				position: 'bottomright',
				click: app.add_venue
			}).addTo(map);

			L.control.geocoder(app.config.mapzen_api_key, {
				expanded: true,
				attribution: '<a href="https://mapzen.com/" target="_blank">Mapzen</a> | <a href="https://openstreetmap.org/">OSM</a>'
			}).addTo(map);
			if (! app.config.feature_flag_search) {
				$(document.body).addClass('search-disabled');
			}
		}

		app.setup_tangram();

		var view = location.hash.match(/#(.+?)\/(.+?)\/(.+)$/);
		if (view) {
			map.setView([view[2], view[3]], view[1]);
		} else if (app.data.latitude != null &&
		           app.data.longitude != null &&
		           app.data.zoom != null) {
			map.setView([app.data.latitude, app.data.longitude], app.data.zoom);
		} else if (wof && wof['geom:bbox']) {
			var bbox = wof['geom:bbox'].split(',');
			var swlat = parseFloat(bbox[1]);
			var swlon = parseFloat(bbox[0]);
			var nelat = parseFloat(bbox[3]);
			var nelon = parseFloat(bbox[2]);
			app.map.fitBounds([[swlat, swlon], [nelat, nelon]]);
		} else {
			// something something geolocation?
		}

		var hash = new L.Hash(map);

		if (! $(document.body).hasClass('print')) {
			app.show_venues(app.data.venues);
		}

		$('.leaflet-pelias-search-icon').html('<span class="fa fa-bars"></span>');

		$('.leaflet-pelias-input').focus(function() {
			$('.leaflet-pelias-search-icon .fa').removeClass('fa-bars');
			$('.leaflet-pelias-search-icon .fa').addClass('fa-search');
		});

		$('.leaflet-pelias-input').blur(function() {
			$('.leaflet-pelias-search-icon .fa').removeClass('fa-search');
			$('.leaflet-pelias-search-icon .fa').addClass('fa-bars');
		});

		map.on('popupclose', function() {
			$('.leaflet-popup').removeClass('editing');
		});

		if ($(document.body).hasClass('print')) {
			app.tangram.scene.subscribe({
				view_complete: function() {
					// Not actually complete, just wait one more second
					setTimeout(function() {
						app.screengrab();
					}, 1000);
				}
			});
		}
	},

	setup_tangram: function() {

		var scene = app.get_tangram_scene();
		console.log('scene', scene);
		app.tangram = Tangram.leafletLayer({
			scene: scene
		}).addTo(app.map);

		app.tangram.scene.subscribe({
			load: function() {
				var sources = app.config.sources[app.data.base];
				for (var source in sources) {
					if (sources[source].url.substr(0, 24) == 'https://tile.mapzen.com/') {
						sources[source].url_params = {
							api_key: app.config.mapzen_api_key
						};
					}
					app.tangram.scene.setDataSource(source, sources[source]);
				}
				app.tangram.scene.updateConfig();
				console.log('sources', app.tangram.scene.config.sources);
			}
		});
	},

	setup_menu: function() {

		$('.leaflet-pelias-search-icon').click(function() {
			if (app.config.feature_flag_edit) {
				app.edit_map();
			} else {
				app.map_details();
			}
		});

		$('#menu .close').click(app.hide_menu);

		$('#map').click(function(e) {
			var venue_id = $(e.target)
				.closest('.venue')
				.data('venue-id');
			if ($(e.target).hasClass('icon') ||
			    $(e.target).closest('.icon').length > 0) {
				if (app.config.feature_flag_edit) {
					app.edit_venue(venue_id);
				}
				e.preventDefault();
			} else if ($(e.target).hasClass('name') ||
			           $(e.target).closest('.name').length > 0 &&
			           ! $(e.target).closest('.leaflet-popup').hasClass('editing')) {
				if (app.config.feature_flag_edit) {
					app.edit_name($(e.target).closest('.venue'));
				}
				e.preventDefault();
			}
		});

		$('.btn-cancel').click(function(e) {
			e.preventDefault();
			app.hide_menu();
		});

		$(window).keypress(function(e) {
			if (e.keyCode == 27 && $('#menu').hasClass('active')) {
				e.preventDefault();
				app.hide_menu();
			}
		});

		app.setup_edit_map_form();
		app.setup_edit_venue_form();
	},

	setup_edit_map_form: function() {
		$('#edit-map').submit(function(e) {
			e.preventDefault();
			app.edit_map_save();
		});
		var base_url = location.protocol + '//' + location.host + '/';
		$('#edit-map-base-url').html(base_url);
		$('#edit-map-set-view').click(function(e) {
			e.preventDefault();
			var ll = app.map.getCenter();
			var zoom = Math.round(app.map.getZoom());
			$('#edit-map-latitude').val(ll.lat);
			$('#edit-map-longitude').val(ll.lng);
			$('#edit-map-zoom').val(zoom);
		});
		$('#edit-map-base').change(function() {
			var base = $('#edit-map-base').val();
			if (base == 'refill') {
				var theme = $('#edit-map-refill-theme').val();
				$('#edit-map-preview').attr('src', '/img/preview-refill-' + theme + '.jpg');
			} else if (base == 'walkabout') {
				$('#edit-map-preview').attr('src', '/img/preview-walkabout.jpg');
			} else if (base == 'bubble-wrap') {
				$('#edit-map-preview').attr('src', '/img/preview-bubble-wrap.jpg');
			}
			$('.edit-map-options').removeClass('selected');
			$('#edit-map-options-' + base).addClass('selected');
		});
		$('#edit-map-refill-theme').change(function() {
			var theme = $('#edit-map-refill-theme').val();
			$('#edit-map-preview').attr('src', '/img/preview-refill-' + theme + '.jpg');
		});
		$('#edit-map .edit-delete').click(function(e) {
			e.preventDefault();
			if (confirm('Are you sure you want to delete the map?')) {
				app.delete_map();
			}
		});
	},

	setup_edit_venue_form: function() {
		$('#edit-venue').submit(function(e) {
			e.preventDefault();
			app.edit_venue_save();
		});
		$('#edit-venue .edit-delete').click(function(e) {
			e.preventDefault();
			app.delete_venue();
		});
		$('#edit-venue-color').change(function() {
			var color = $('#edit-venue-color').val();
			$('#edit-venue-icon-preview').css('background-color', color);
			var hsl = app.hex2hsl(color);
			if (hsl.l < 0.66) {
				$('#edit-venue-icon-preview .icon').addClass('inverted');
			} else {
				$('#edit-venue-icon-preview .icon').removeClass('inverted');
			}
		});
		$('#edit-venue-colors a').each(function(i, link) {
			var color = $(link).data('color');
			$(link).css('background-color', color);
			$(link).click(function(e) {
				e.preventDefault();
				$('#edit-venue-color').val(color);
				$('#edit-venue-icon-preview').css('background-color', color);
				var hsl = app.hex2hsl(color);
				if (hsl.l < 0.66) {
					$('#edit-venue-icon-preview .icon').addClass('inverted');
				} else {
					$('#edit-venue-icon-preview .icon').removeClass('inverted');
				}
			});
		});
	},

	setup_screengrab: function() {
		$(document.body).keypress(function(e) {
			if ((e.key == 's' || e.key == 'S') && e.metaKey) {
				e.preventDefault();
				app.screengrab();
			}
		});
	},

	setup_icons: function() {

		var default_recent = [
			'restaurant',
			'cafe',
			'grocery',
			'bar',
			'cinema',
			'garden',
			'park',
			'library',
			'shop'
		];

		var recent = app.data.options.recent_icons || [];
		for (var icon, i = 0; i < default_recent.length; i++) {
			icon = default_recent[i];
			if (recent.indexOf(icon) == -1) {
				recent.push(icon);
			}
		}

		var icons = [];
		for (var i = 0; i < recent.length; i++) {
			icons.push('<a href="#" class="icon-bg" data-icon="' + recent[i] + '"><span class="icon" style="background-image: url(/img/icons/' + recent[i] + '.svg);"></span><span class="icon-label">' + recent[i] + '</span></a>');
			if (icons.length == 9) {
				break;
			}
		}
		$('#edit-venue-recent-icons .holder').html(icons.join(''));
		$('#edit-venue-recent-icons .icon-bg').click(app.venue_icon_click);

		if ($('#edit-venue-icons .icon-bg').length == 0) {

			app.api_call('get_icons').then(function(rsp) {
				var icons = '';
				$.each(rsp.icons, function(i, icon) {
					icons += '<a href="#" class="icon-bg" data-icon="' + icon + '"><span class="icon" style="background-image: url(/img/icons/' + icon + '.svg);" title="' + icon + '"></span><span class="icon-label">' + icon + '</span></a>';
				});
				$('#edit-venue-icons').html(icons);
				$('#edit-venue-icons .icon-bg').click(app.venue_icon_click);
			});

			$('#edit-venue-show-icons').click(function(e) {
				e.preventDefault();
				$('#edit-venue-icons').toggleClass('hidden');
				if ($('#edit-venue-icons').hasClass('hidden')) {
					$(this).html('show all icons');
				} else {
					$(this).html('hide all icons');
				}
			});

			$('#edit-venue-default-icon').click(function(e) {
				e.preventDefault();
				var options = app.data.options;
				options.default_icon = $('#edit-venue-icon').val();
				options.default_color = $('#edit-venue-color').val();
				app.update_data({
					options: options
				});
				app.setup_add_venue();
				$('#edit-venue-default-icon').html('default icon updated');
			});
		}

	},

	setup_config: function(cb) {
		$.get('/tiles/tiles.json').then(function(config) {
			app.config = L.extend(app.config_defaults, config);
			if (! app.config.feature_flag_edit) {
				$(document.body).addClass('readonly');
			}
			if (! app.config.feature_flag_search) {
				$(document.body).addClass('disable-search');
			}
			if (app.data.latitude == null ||
			    app.data.longitude == null ||
			    app.data.zoom == null) {
				if (app.config.wof_ids.length == 0) {
					console.error('No WOF ID found in tiles.json');
				} else {
					var id = app.config.wof_ids[0];
					$.get('/tiles/' + id + '.json').then(function(rsp) {
						cb(rsp.place);
					});
				}
			} else {
				cb();
			}
		});
	},

	setup_map_details: function() {
		var name = app.data.name || 'Untitled map';
		$('#map-details-name').html(name);
		if (app.data.authors) {
			$('#map-details-authors').html('by ' + app.data.authors);
		} else {
			$('#map-details-authors').addClass('hidden');
		}

		var description = app.data.description || "";
		description = description.trim();
		description = description.replace(/\n/g, "<br>");
		$('#map-details-description').html(description);
	},

	setup_choose_map: function(wof) {
		app.api_call('get_maps').then(function(rsp) {
			var html = '<li><a href="#" id="create-map"><i>Create a new map</i></a>';
			$.each(rsp.maps, function(i, map) {
				var item = map.name;
				item = '<a href="/' + map.slug + '" data-id="' + map.id + '">' + item + '</a>';
				if (map.authors) {
					item += ' by ' + map.authors;
				}
				html += '<li>' + item + '</li>';
			});
			$('#choose-map-list').html(html);
			$('#create-map').click(function(e) {
				var lat = wof['geom:latitude'];
				var lng = wof['geom:longitude'];
				if ('lbl:latitude' in wof) {
					lat = wof['lbl:latitude'];
				}
				if ('lbl:longitude' in wof) {
					lng = wof['lbl:longitude'];
				}
				var view = {
					latitude: lat,
					longitude: lng,
					zoom: 12
				};
				app.add_map(view, function() {
					app.setup_map();
					app.hide_menu();
					app.setup_menu();
				});
			});
			app.choose_map();
		});
	},

	setup_add_venue: function() {
		var options = app.data.options;
		var color = options.default_color || '#8442D5';
		var icon = options.default_icon || 'marker-stroked';
		var image = 'url(/img/icons/' + icon + '.svg)';
		$('.leaflet-control-add-venue .icon-bg').css('background-color', color);
		$('.leaflet-control-add-venue .icon').css('background-image', image);
		var hsl = app.hex2hsl(color);
		if (hsl.l < 0.66) {
			$('.leaflet-control-add-venue .icon').addClass('inverted');
		} else {
			$('.leaflet-control-add-venue .icon').removeClass('inverted');
		}
	},

	load_map: function(id) {
		app.api_call('get_map', {
			id: id
		}).then(function(rsp) {
			if (rsp.map) {

				if (rsp.map.current == 0) {
					console.error('map ' + id + ' is not current');
					return;
				}

				app.data = app.normalize_data(rsp.map);
				localforage.setItem('map_id', id);
				localforage.setItem('map_' + id, app.data);

				var ll = [app.data.latitude, app.data.longitude];
				app.map.setView(ll, app.data.zoom);

				app.map.eachLayer(function(layer) {
					if (layer.venue) {
						app.map.removeLayer(layer);
					}
				});
				app.show_venues(app.data.venues);
				document.title = app.data.name;
			} else if (rsp.error) {
				console.error(rsp.error);
			} else {
				console.error('could not load map ' + id);
			}
		});
	},

	add_map: function(view, callback) {
		app.api_call('add_map', view).then(function(rsp) {
			if (rsp.map) {
				app.data = rsp.map;
				localforage.setItem('map_id', app.data.id);
				localforage.setItem('map_' + app.data.id, rsp.map);
				if (typeof callback == 'function') {
					callback();
				}
			} else if (rsp.error) {
					console.error(rsp.error);
			} else {
				console.error('could not setup_data');
			}

			var state = {
				id: rsp.map.id,
				slug: rsp.map.slug
			};
			history.pushState(state, rsp.map.name, '/' + rsp.map.slug);
		});
	},

	map_details: function() {
		app.show_menu('map-details');
		$('#choose-map').addClass('visible');
	},

	choose_map: function() {
		app.show_menu('choose-map');
	},

	edit_map: function() {
		var options = L.extend(app.data_defaults.options, app.data.options);
		$('#edit-map-name').val(app.data.name);
		$('#edit-map-description').val(app.data.description);
		$('#edit-map-authors').val(app.data.authors);
		$('#edit-map-slug').val(app.data.slug);
		$('#edit-map-latitude').val(app.data.latitude);
		$('#edit-map-longitude').val(app.data.longitude);
		$('#edit-map-zoom').val(app.data.zoom);
		$('#edit-map-id').val(app.data.id);
		$('#edit-map-base').val(app.data.base);
		$('#edit-map-transit')[0].checked = app.data.options.transit;
		if (app.data.base == 'refill') {
			$('#edit-map-refill-theme').val(options.refill_theme);
			$('#edit-map-refill-detail').val(options.refill_detail);
			$('#edit-map-refill-label').val(options.refill_label);
			$('#edit-map-preview').attr('src', '/img/preview-refill-' + options.refill_theme + '.jpg');
		} else if (app.data.base == 'walkabout') {
			$('#edit-map-preview').attr('src', '/img/preview-walkabout.jpg');
			$('#edit-map-walkabout-path')[0].checked = app.data.options.walkabout_path;
			$('#edit-map-walkabout-bike')[0].checked = app.data.options.walkabout_bike;
		} else if (app.data.base == 'bubble-wrap') {
			$('#edit-map-preview').attr('src', '/img/preview-bubble-wrap.jpg');
			$('#edit-map-bubble-wrap-labels').val(app.data.options.bubble_wrap_labels);
		}
		$('.edit-map-options').removeClass('selected');
		$('#edit-map-options-' + app.data.base).addClass('selected');
		$('#edit-map-print').attr('href', '/' + app.data.slug + '?print=1' + location.hash);

		app.show_menu('edit-map');

		var width = $('#edit-map-slug-holder').width();
		width -= $('#edit-map-slug-holder pre').width();
		$('#edit-map-slug').css('width', width);
	},

	edit_map_save: function() {

		var id = parseInt($('#edit-map-id').val());
		var name = $('#edit-map-name').val();
		var authors = $('#edit-map-authors').val();
		var slug = $('#edit-map-slug').val();
		var description = $('#edit-map-description').val();
		var latitude = parseFloat($('#edit-map-latitude').val());
		var longitude = parseFloat($('#edit-map-longitude').val());
		var zoom = parseInt($('#edit-map-zoom').val());
		var base = $('#edit-map-base').val();
		var options = app.edit_map_options();

		app.data.name = name;
		app.data.authors = authors;
		app.data.slug = slug;
		app.data.description = description;
		app.data.latitude = latitude;
		app.data.longitude = longitude;
		app.data.zoom = zoom;
		app.data.base = base;
		app.data.options = options;

		$('.edit-rsp').html('Saving...');
		$('.edit-rsp').removeClass('error');

		localforage.setItem('map_' + app.data.id, app.data)
			.then(function(rsp) {
				console.log('updated localforage', rsp);
			});

		var data = {
			id: id,
			name: name,
			authors: authors,
			slug: slug,
			description: description,
			latitude: latitude,
			longitude: longitude,
			zoom: zoom,
			base: base,
			options: JSON.stringify(options)
		};
		app.api_call('update_map', data).then(function(rsp) {
			if (rsp.error) {
				$('.edit-rsp').html(rsp.error);
				$('.edit-rsp').addClass('error');
				return;
			} else if (! rsp.map) {
				$('.edit-rsp').html('Oops, something went wrong while saving. Try again?');
				$('.edit-rsp').addClass('error');
				return;
			} else {
				document.title = rsp.map.name;
				console.log('updated db', rsp);
			}
			$('.edit-rsp').html('');
			app.hide_menu();

			if (location.pathname != '/' + rsp.map.slug) {
				var state = {
					id: rsp.map.id,
					slug: rsp.map.slug
				};
				history.pushState(state, rsp.map.name, '/' + rsp.map.slug);
			}
		});

		app.map.removeLayer(app.tangram);
		app.tangram = app.setup_tangram();
	},

	edit_map_options: function() {
		var options = app.data.options || {};
		var base = $('#edit-map-base').val();
		if (base == 'refill') {
			var style_options = {
				refill_theme: $('#edit-map-refill-theme').val(),
				refill_detail: $('#edit-map-refill-detail').val(),
				refill_label: $('#edit-map-refill-label').val()
			};
		} else if (base == 'walkabout') {
			var style_options = {
				walkabout_path: $('#edit-map-walkabout-path')[0].checked,
				walkabout_bike: $('#edit-map-walkabout-bike')[0].checked
			};
		} else if (base == 'bubble-wrap') {
			var style_options = {
				bubble_wrap_labels: $('#edit-map-bubble-wrap-labels').val()
			};
		}
		options = L.extend(options, style_options);
		options.transit = $('#edit-map-transit')[0].checked;
		return options;
	},

	delete_map: function() {
		var id = app.data.id;
		app.data.current = 0;

		localforage.setItem('map_' + app.data.id, app.data)
			.then(function(rsp) {
				console.log('updated localforage', rsp);
			});

		$('.edit-rsp').html('Deleting...');
		$('.edit-rsp').removeClass('error');

		var data = {
			id: id
		};
		app.api_call('delete_map', data).then(function(rsp) {
			if (rsp.error) {
				$('.edit-rsp').html(rsp.error);
				$('.edit-rsp').addClass('error');
				return;
			}
			$('.edit-rsp').html('');
			app.hide_menu();
		});

		app.reset_map();
	},

	add_venue: function() {
		var options = app.data.options;
		var color = options.default_color || '#8442D5';
		var icon = options.default_icon || 'marker-stroked';
		var ll = app.map.getCenter();
		var venue = L.extend(app.venue_defaults, {
			map_id: app.data.id,
			latitude: ll.lat,
			longitude: ll.lng,
			icon: icon,
			color: color
		});

		var index = app.data.venues.length;
		app.data.venues.push(venue);
		localforage.setItem('map_' + app.data.id, app.data);

		var marker = app.add_marker(venue);
		marker.openPopup();

		app.api_call('add_venue', venue).then(function(rsp) {
			if (rsp.venue) {
				app.data.venues[index] = rsp.venue;
				localforage.setItem('map_' + app.data.id, app.data);
				marker.venue = rsp.venue;
				$(app.map.getPane('popupPane'))
					.find('.venue')
					.attr('data-venue-id', rsp.venue.id);
				app.update_marker(marker, rsp.venue);
			} else if (rsp.error) {
				console.error(rsp.error);
			} else {
				console.error('could not add_venue');
			}
		});
	},

	edit_venue: function(id) {
		var venue = null;
		for (var i = 0; i < app.data.venues.length; i++) {
			if (app.data.venues[i].id == id) {
				venue = app.data.venues[i];
				break;
			}
		}

		if (! venue) {
			console.error('could not find venue ' + id + ' to edit');
			return;
		}

		$('#edit-venue-id').val(id);
		$('#edit-venue-name').val(venue.name);
		$('#edit-venue-address').val(venue.address);
		$('#edit-venue-tags').val(venue.tags);
		$('#edit-venue-url').val(venue.url);
		$('#edit-venue-description').val(venue.description);
		$('#edit-venue-icon').val(venue.icon);
		$('#edit-venue-icon-preview').css('background-color', venue.color);
		$('#edit-venue-icon-preview .icon').css('background-image', 'url("/img/icons/' + venue.icon + '.svg")');
		$('#edit-venue-color').val(venue.color);

		var hsl = app.hex2hsl(venue.color);
		if (hsl.l < 0.66) {
			$('#edit-venue-icon-preview .icon').addClass('inverted');
		} else {
			$('#edit-venue-icon-preview .icon').removeClass('inverted');
		}

		app.setup_icons();
		app.show_menu('edit-venue');
	},

	edit_venue_save: function() {

		var id = parseInt($('#edit-venue-id').val());
		var name = $('#edit-venue-name').val();
		var icon = $('#edit-venue-icon').val();
		var color = $('#edit-venue-color').val();
		var address = $('#edit-venue-address').val();
		var tags = $('#edit-venue-tags').val();
		var url = $('#edit-venue-url').val();
		var description = $('#edit-venue-description').val();
		var venue = null;

		for (var i = 0; i < app.data.venues.length; i++) {
			if (app.data.venues[i].id == id) {
				venue = app.data.venues[i];
				venue.name = name;
				venue.icon = icon;
				venue.color = color;
				venue.address = address;
				venue.tags = tags;
				venue.url = url;
				venue.description = description;
				console.log('updated app.data', venue);
				break;
			}
		}

		if (! venue) {
			$('.edit-rsp').html('Oops, could not find venue ' + id + ' to save.');
			$('.edit-rsp').addClass('error');
			return;
		}

		app.map.eachLayer(function(layer) {
			if (layer.venue &&
			    layer.venue.id == id) {
				console.log('update marker');
				app.update_marker(layer, venue);
			}
		});

		app.add_recent_icon(venue.icon);

		localforage.setItem('map_' + app.data.id, app.data)
			.then(function(rsp) {
				console.log('updated localforage', rsp);
			});

		$('.edit-rsp').html('Saving...');
		$('.edit-rsp').removeClass('error');

		var data = {
			id: id,
			name: name,
			icon: icon,
			color: color,
			address: address,
			tags: tags,
			url: url,
			description: description
		};
		app.api_call('update_venue', data).then(function(rsp) {
			if (rsp.error) {
				$('.edit-rsp').html(rsp.error);
				$('.edit-rsp').addClass('error');
				return;
			} else if (! rsp.venue) {
				$('.edit-rsp').html('Oops, something went wrong while saving. Try again?');
				$('.edit-rsp').addClass('error');
				return;
			} else {
				console.log('updated db', rsp);
			}
			$('.edit-rsp').html('');
			app.hide_menu();
		});
	},

	delete_venue: function() {
		var id = parseInt($('#edit-venue-id').val());

		var new_venues = [];
		for (var i = 0; i < app.data.venues.length; i++) {
			if (app.data.venues[i].id == id) {
				continue;
			}
			new_venues.push(app.data.venues[i]);
		}
		app.data.venues = new_venues;

		localforage.setItem('map_' + app.data.id, app.data)
			.then(function(rsp) {
				console.log('updated localforage', rsp);
			});

		app.map.eachLayer(function(layer) {
			if (layer.venue &&
			    layer.venue.id == id) {
				app.map.removeLayer(layer);
			}
		});

		$('.edit-rsp').html('Deleting...');
		$('.edit-rsp').removeClass('error');

		var data = {
			id: id
		};
		app.api_call('delete_venue', data).then(function(rsp) {
			if (rsp.error) {
				$('.edit-rsp').html(rsp.error);
				$('.edit-rsp').addClass('error');
				return;
			}
			$('.edit-rsp').html('');
			app.hide_menu();
		});
	},

	edit_name: function($venue) {
		console.log('edit_name', $venue);
		if ($venue.length == 0) {
			return;
		}
		$venue.closest('.leaflet-popup').addClass('editing');
		console.log($venue.find('.name .inner'));
		var name = $venue.find('.name .inner').html();
		$venue.find('.name').html('<input type="text" class="edit-name">');
		$venue.find('.name input').val(name);
		$venue.find('.name input')[0].select();
		console.log($venue.find('.name input'));
	},

	edit_name_save: function() {
		var name = $('.leaflet-popup input').val();
		$('.leaflet-popup .name').html('<span class="inner">' + name + '</span>');
		$('.leaflet-popup').removeClass('editing');

		var id = $('.leaflet-popup form').data('venue-id');
		var venue = null;

		for (var i = 0; i < app.data.venues.length; i++) {
			if (app.data.venues[i].id == id) {
				venue = app.data.venues[i];
				venue.name = name;
				console.log('updated app.data', venue);
				break;
			}
		}

		if (! venue) {
			console.error('could not save name for id ' + id);
			return;
		}

		localforage.setItem('map_' + app.data.id, app.data)
			.then(function(rsp) {
				console.log('updated localforage', rsp);
			});

		var data = {
			id: id,
			name: name,
		};
		app.api_call('update_venue', data).then(function(rsp) {
			if (rsp.error) {
				console.error(rsp.error);
				return;
			} else if (! rsp.venue) {
				console.error('Oops, something went wrong while saving. Try again?');
				return;
			} else {
				console.log('updated db', rsp);
			}
		});
	},

	add_marker: function(venue) {
		var ll = [venue.latitude, venue.longitude];
		var marker = new L.marker(ll, {
			icon: app.map_marker_icon,
			draggable: true,
			riseOnHover: true
		});
		marker.addTo(app.map);
		app.update_marker(marker, venue);

		marker.on('popupopen', function() {
			this.unbindTooltip();
		});

		marker.on('popupclose', function() {
			if (this.venue.name) {
				this.bindTooltip(this.venue.name);
			}
		});

		marker.on('moveend', function() {
			var latlng = this.getLatLng();
			var data = {
				id: venue.id,
				latitude: latlng.lat,
				longitude: latlng.lng
			};
			app.api_call('update_venue', data);
		});
		return marker;
	},

	update_marker: function(marker, venue) {
		marker.venue = venue;
		var name = venue.name || (venue.latitude.toFixed(6) + ', ' + venue.longitude.toFixed(6));
		var extra = '';
		extra = venue.address ? '<div class="extra">' + venue.address + '</div>' : extra;
		extra = venue.tags ? '<div class="extra">' + venue.tags + '</div>' : extra;
		var data_id = venue.id ? ' data-venue-id="' + venue.id + '"' : '';
		var hsl = app.hex2hsl(venue.color);
		var icon_inverted = (hsl.l < 0.66) ? ' inverted' : '';
		var html = '<form action="/data.php" class="venue"' + data_id + ' onsubmit="app.edit_name_save(); return false;">' +
				'<div class="icon-bg" style="background-color: ' + venue.color + ';">' +
				'<div class="icon' + icon_inverted + '" style="background-image: url(/img/icons/' + venue.icon + '.svg);"></div></div>' +
				'<div class="name"><span class="inner">' + name + '</span>' + extra + '</div>' +
				'<div class="clear"></div>' +
				'</form>';
		marker.bindPopup(html);
		if (venue.name) {
			marker.bindTooltip(venue.name);
		} else {
			marker.unbindTooltip();
		}
		var rgb = app.hex2rgb(venue.color);
		if (rgb && marker._icon) {
			var rgba = [rgb.r, rgb.g, rgb.b, 0.7];
			rgba = 'rgba(' + rgba.join(',') + ')';
			marker._icon.style.backgroundColor = rgba;
		}
	},

	show_venues: function(venues) {
		if (! venues) {
			return;
		}
		app.data.venues = venues;
		for (var i = 0; i < venues.length; i++) {
			if (venues[i].current) {
				app.add_marker(venues[i]);
			}
		}
	},

	reset_map: function() {
		app.data = app.data_defaults;
		localforage.setItem('map_id', 0);
		app.map.eachLayer(function(layer) {
			if (layer.venue) {
				app.map.removeLayer(layer);
			}
		});
		document.title = app.data_defaults.name;
	},

	update_data: function(updates) {

		app.data = L.extend(app.data, updates);
		localforage.setItem('map_' + app.data.id, app.data);

		updates.id = app.data.id;
		if (typeof updates.options == 'object') {
			updates.options = JSON.stringify(updates.options);
		}

		app.api_call('update_map', updates)
			.then(function(rsp) {
				if (rsp.error) {
					console.error(rsp.error);
				} else {
					app.data.updated = rsp.map.updated;
				}
			});
	},

	api_call: function(method, data) {
		if (! data) {
			data = {};
		}
		data.method = method;
		return $.ajax({
			method: 'POST',
			url: '/data.php',
			data: data
		});
	},

	show_menu: function(menu_id) {
		$('#menu .visible').removeClass('visible');
		$('#' + menu_id).addClass('visible');
		$('#menu').addClass('active');
		$('#menu').scrollTop(0);
	},

	hide_menu: function() {
		$('#menu').removeClass('active');
	},

	get_tangram_scene: function() {

		var base = app.data.base;
		var options = L.extend(app.data_defaults.options, app.data.options);
		var scene = {
			global: {
				sdk_mapzen_api_key: app.config.mapzen_api_key
			}
		};
		if (base == 'refill') {
			scene.import = [
				'/styles/refill/refill-style.yaml',
				'/styles/refill/themes/color-' + options.refill_theme + '.yaml',
				'/styles/refill/themes/detail-' + options.refill_detail + '.yaml',
				'/styles/refill/themes/label-' + options.refill_label + '.yaml'
			];
		} else if (base == 'walkabout') {
			scene.import = [
				'/styles/walkabout/walkabout-style.yaml',
			];
			if (options.walkabout_path) {
				scene.global.sdk_path_overlay = true;
			} else {
				scene.global.sdk_path_overlay = false;
			}
			if (options.walkabout_bike) {
				scene.global.sdk_bike_overlay = true;
			} else {
				scene.global.sdk_bike_overlay = false;
			}
		} else if (base == 'bubble-wrap') {
			var labels = options.bubble_wrap_labels;
			if (labels == 'normal') {
				labels = '';
			} else {
				labels = '-' + labels;
			}
			scene.import = [
				'/styles/bubble-wrap/bubble-wrap-style' + labels + '.yaml',
			];
		}
		if (options.transit) {
			scene.global.sdk_transit_overlay = true;
		} else {
			scene.global.sdk_transit_overlay = false;
		}

		if (location.search.indexOf('print') !== -1) {
			scene.import.push('/data.php?method=get_tangram_layer&id=' + app.data.id);
		}

		return scene;
	},

	normalize_data: function(data) {
		if (typeof data.options == 'object') {
			data.options = L.extend(app.data_defaults.options, data.options);
		} else if (typeof data.options == 'undefined') {
			data.options = app.data_defaults.options;
		}
		if (typeof data.base == 'undefined') {
			data.base = 'refill';
		}
		if (typeof data.theme == 'string') {
			data.options.refill_theme = data.theme;
			delete data.theme;
		}
		if (typeof data.labels != 'undefined') {
			delete data.labels;
		}
		if (typeof data.default_color != 'undefined') {
			delete data.default_color;
		}
		return data;
	},

	screengrab: function() {
		var scene = app.tangram.scene;
		scene.screenshot().then(function(sh) {
			var prefix = app.data.name.toLowerCase().replace(/\s+/, '-');
			var fname = prefix + '-' + (new Date().getTime()) + '.png';
			saveAs(sh.blob, fname);
		});
	},

	load_cached: function(url, cb) {
		localforage.getItem('cache-' + url, function(html) {
			if (html) {
				cb(html);
			} else {
				$.get(url, function(html) {
					cb(html);
					localforage.setItem('cache-' + url, html);
					localforage.getItem('cache-index', function(index) {
						if (! index) {
							index = [];
						}
						index.push(url);
						localforage.setItem('cache-index', index);
					});
				});
			}
		});
	},

	reset_cache: function() {
		localforage.getItem('cache-index', function(index) {
			if (! index) {
				return;
			}
			for (var i = 0; i < index.length; i++) {
				localforage.removeItem('cache-' + index[i]);
			}
		});
	},

	// from https://stackoverflow.com/a/5624139/937170
	hex2rgb: function(hex) {
		// Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
		var shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
		hex = hex.replace(shorthandRegex, function(m, r, g, b) {
			return r + r + g + g + b + b;
		});

		var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
		return result ? {
			r: parseInt(result[1], 16),
			g: parseInt(result[2], 16),
			b: parseInt(result[3], 16)
		} : null;
	},

	// from https://gist.github.com/mjackson/5311256
	rgb2hsl: function(rgb) {
		var r = rgb.r;
		var g = rgb.g;
		var b = rgb.b;
		r /= 255, g /= 255, b /= 255;
		var max = Math.max(r, g, b), min = Math.min(r, g, b);
		var h, s, l = (max + min) / 2;
		if (max == min) {
			h = s = 0; // achromatic
		} else {
			var d = max - min;
			s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

			switch (max) {
				case r: h = (g - b) / d + (g < b ? 6 : 0); break;
				case g: h = (b - r) / d + 2; break;
				case b: h = (r - g) / d + 4; break;
			}

			h /= 6;
		}
		return {
			h: h,
			s: s,
			l: l
		};
	},

	hex2hsl: function(hex) {
		var rgb = app.hex2rgb(hex);
		return app.rgb2hsl(rgb);
	},

	add_recent_icon: function(icon) {
		var recent = this.data.options.recent_icons || [];
		var curr_index = recent.indexOf(icon);
		if (curr_index > -1) {
			recent.splice(curr_index, 1);
		}
		recent.unshift(icon);
		this.data.options.recent_icons = recent;
		app.update_data({
			options: this.data.options
		});
	},

	venue_icon_click: function(e) {
		e.preventDefault();
		var icon = $(this).data('icon');
		$('#edit-venue-icon-preview .icon').css('background-image', 'url("/img/icons/' + icon + '.svg")');
		$('#edit-venue-icon').val(icon);
		if ($(this).closest('#edit-venue-icons').length > 0) {
			$('#edit-venue-icons').addClass('hidden');
			$('#edit-venue-show-icons').html('show all icons');
			var scroll_offset = $('label[for="edit-venue-icon"]').offset().top - 20;
			if (scroll_offset < 0) {
				$('#menu').animate({
					scrollTop: $('#menu').scrollTop() + scroll_offset
				}, 500, 'swing');
			}
		}
	}

};
app.setup();
