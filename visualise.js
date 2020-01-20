// Javascript functions for displaying Bluetruth data

/* eslint no-console: "off" */
/*global $, L, LOCATIONS_URL, JOURNEYS_URL, MB_ACCESS_TOKEN, TF_API_KEY */

// m/sec to mph
var TO_MPH = 2.23694;

// Style options for markers and lines
var SITE_OPTIONS = {
    color: 'black',
    fillColor: 'green',
    fill: true,
    fillOpacity: 0.8,
    radius: 7,
    pane: 'markerPane'
};

var NORMAL_LINE = {
    weight: 5,
    offset: -3
};
var HIGHLIGHT_LINE = {
    weight: 10,
    offset: -6
};

var NORMAL_COLOUR = '#3388ff';
var VERY_SLOW_COLOUR = '#9a111a';
var SLOW_COLOUR = '#e00018';
var MEDIUM_COLOUR = '#eb7F1b';
var FAST_COLOUR = '#85cd50';
var BROKEN_COLOUR = '#b0b0b0';

// Script state globals
var map, // The Leaflet map object itself
    sites_layer, // layer containing the sensor sites
    links_layer, // Layer containing the point to point links
    compound_routes_layer, // Layer containing the compound routes
    layer_control, // The layer control
    clock, // The clock control
    hilighted_line, // The currently highlighted link or route
    speed_display = 'actual', // Line colour mode - 'actual', 'normal' or 'relative'
    line_map = {}; // Lookup link/route id to displayed polyline


var all_sites, traffic_data = [],
    all_links;


var minmax, myColors;

var SITE_DB = [];

// Initialise
$(document).ready(function () {

    setup_map();
    load_data();
    // voronoiMap();

    //console.log(all_sites);
    //drawVaronoi();

});

// Setup the map environment
function setup_map() {

    // Various feature layers
    sites_layer = L.featureGroup();
    links_layer = L.featureGroup();
    compound_routes_layer = L.featureGroup();

    // Various map providers
    var osm = L.tileLayer.provider('OpenStreetMap.Mapnik');
    var tf = L.tileLayer.provider('Thunderforest.Neighbourhood', {
        apikey: TF_API_KEY
    });

    map = L.map('map', {
        zoomControl: false
    });

    // Map legend
    //get_legend().addTo(map);

    // Layer control
    var base_layers = {
        'OSM': osm,
        'ThunderForest': tf,
    };
    var overlay_layers = {
        'Sites': sites_layer,
        'All links': links_layer,

    };
    layer_control = L.control.layers(base_layers, overlay_layers, {
        collapsed: true
    }).addTo(map);

    //  Zoom control (with non-default position)
    L.control.zoom({
        position: 'topright'
    }).addTo(map);

    // Clock
    clock = get_clock().addTo(map);

    // Handler to clear any highlighting caused by clicking lines
    map.on('click', clear_line_highlight);

    // Centre on Cambridge and add default layers
    var cambridge = new L.LatLng(52.20038, 0.1197);
    map.setView(cambridge, 13).addLayer(osm).addLayer(sites_layer).addLayer(links_layer);//.addLayer(voronoi)

}


// Async load locations, annotate with auto-refreshing journey times
function load_data() {

    $.get(LOCATIONS_URL)
        .done(function (locations) {

            // Sites
            // add_sites(locations.sites);
            all_sites = locations.sites;
            all_links = locations.links
            set_points(all_sites);


            // Links and Compound routes
            // add_lines(locations.links, locations.sites, links_layer);
            //add_lines(locations.compoundRoutes, locations.sites, compound_routes_layer);

            // Scale map to fit
            //var region = sites_layer.getBounds().extend(links_layer);
            //map.fitBounds(region);

            // Load (and schedule for reload) journey times
            load_journey_times();
            //d3.select('svg').remove();
            //voronoiMap();

        });

}

function set_points(pts) {
    all_sites = pts;
}

function get_points() {
    return all_sites;
}
// Helper function to draw  sites
function add_sites(sites) {

    for (var i = 0; i < sites.length; ++i) {
        var site = sites[i];
        var marker = L.circleMarker([site.location.lat, site.location.lng], SITE_OPTIONS)
            .bindPopup(site_popup, {
                maxWidth: 500
            })
            .addTo(sites_layer);
        marker.properties = {
            'site': site
        };

    }
}


// Helper function to draw links and compound routes
function add_lines(lines, sites, layer) {

    for (var i = 0; i < lines.length; ++i) {
        var line = lines[i];

        // Accumulate points
        var points = [];
        for (var j = 0; j < line.sites.length; ++j) {
            var site = find_object(sites, line.sites[j]);
            if (site) {
                points.push([site.location.lat, site.location.lng]);
            }
        }

        var polyline = L.polyline(points, NORMAL_LINE)
            .setStyle({
                color: NORMAL_COLOUR
            })
            .bindPopup(line_popup, {
                maxWidth: 500
            })
            .on('click', line_highlight)
            .addTo(layer);
        polyline.properties = {
            'line': line
        };

        // Remember the polyline for the future
        line_map[line.id] = polyline;

        // Add compound routes to the map individually, because they can overlap each other
        if (layer === compound_routes_layer) {
            layer_control.addOverlay(polyline, `Route: ${line.name}`);
        }

    }

}


// Load journey times, annotate links and compound routes, and schedule to re-run
function load_journey_times() {

    console.log('(Re-)loading journey times');

    $.get(JOURNEYS_URL)
        .done(function (journeys) {
            traffic_data = [];
            for (var i = 0; i < journeys.length; ++i) {
                var journey = journeys[i];
                traffic_data.push({
                    "id": journey.id,
                    "travelTime": journey.travelTime,
                    "normalTravelTime": journey.normalTravelTime
                });
                // console.log(journey);
                // get corresponding (poly)line
                // var line = line_map[journey.id];
                //line.properties['journey'] = journey;
            }

            // Refresh the line colours
            // update_line_colours();

            // Reset the clock
            clock.update();

            // Re-schedule for a minute in the future
            setTimeout(load_journey_times, 60000);


            d3.select('svg').remove();
            voronoiMap();



        });

}


// Set line's colour based on corresponding journey's travelTime and
// normalTravelTime
function update_line_colours() {

    for (var id in line_map) {
        if (line_map.hasOwnProperty(id)) {
            var line = line_map[id];
            if (speed_display === 'relative') {
                update_relative_speed(line);
            } else {
                update_actual_normal_speed(line);
            }
        }
    }
}


// Set line colour based on travel time (aka speed) compared to normal
function update_relative_speed(polyline) {

    var journey = polyline.properties.journey;
    var choice;
    // Missing
    if (!journey.travelTime) {
        choice = BROKEN_COLOUR;
    }
    // Worse than normal
    else if (journey.travelTime > 1.2 * journey.normalTravelTime) {
        choice = SLOW_COLOUR;
    }
    // Better then normal
    else if (journey.travelTime < 0.8 * journey.normalTravelTime) {
        choice = FAST_COLOUR;
    }
    // Normal(ish)
    else {
        choice = NORMAL_COLOUR;
    }
    polyline.setStyle({
        color: choice
    });

}

// Set line colour based on actual or expected speed
function update_actual_normal_speed(polyline) {

    var journey = polyline.properties.journey;
    var line = polyline.properties.line;
    var time = speed_display === 'actual' ? journey.travelTime : journey.normalTravelTime;
    var speed = (line.length / time) * TO_MPH;
    var choice;
    if (time === null) {
        choice = BROKEN_COLOUR;
    } else if (speed < 5) {
        choice = VERY_SLOW_COLOUR;
    } else if (speed < 10) {
        choice = SLOW_COLOUR;
    } else if (speed < 20) {
        choice = MEDIUM_COLOUR;
    } else {
        choice = FAST_COLOUR;
    }
    polyline.setStyle({
        color: choice
    });
}


// Hilight a clicked line
function line_highlight(e) {

    var line = e.target;

    clear_line_highlight();
    line.setStyle(HIGHLIGHT_LINE)
        .setOffset(HIGHLIGHT_LINE.offset);
    hilighted_line = line;
}


// Clear any line highlight
function clear_line_highlight() {

    if (hilighted_line) {
        hilighted_line.setStyle(NORMAL_LINE)
            .setOffset(NORMAL_LINE.offset);
        hilighted_line = null;
    }

}


// Handle site popups
function site_popup(marker) {

    var site = marker.properties.site;

    return '<table>' +
        `<tr><th>Name</th><td>${site.name}</td></tr>` +
        `<tr><th>Description</th><td>${site.description}</td></tr>` +
        `<tr><th>Id</th><td>${site.id}</td></tr>` +
        '</table>';

}


// Handle line popups
function line_popup(polyline) {

    var line = polyline.properties.line;
    var journey = polyline.properties.journey;

    var message = '<table>' +
        `<tr><th>Name</th><td>${line.name}</td></tr>` +
        `<tr><th>Description</th><tr>${line.description}</td></tr>` +
        `<tr><th>Id</th><td>${line.id}</td></tr>` +
        `<tr><th>Length</th><td>${line.length} m</td></tr>`;

    if (journey) {
        message += `<tr><th>Time</th><td>${journey.time} </dt></tr>` +
            `<tr><th>Period</th><td>${journey.period} s</td></tr>`;
        if (journey.travelTime) {
            var speed = (line.length / journey.travelTime) * TO_MPH;
            message += `<tr><th>Travel Time</th><td>${journey.travelTime.toFixed(0)}s (${speed.toFixed(1)} mph)</td></tr>`;
        }
        if (journey.normalTravelTime) {
            var normal_speed = (line.length / journey.normalTravelTime) * TO_MPH;
            message += `<tr><th>Normal Travel Time</th><td>${journey.normalTravelTime.toFixed(0)}s (${normal_speed.toFixed(1)} mph)</td></tr>`;
        }
    }

    message += '</table>';

    return message;

}

function get_clock() {
    var control = L.control({
        position: 'bottomleft'
    });
    control.onAdd = function () {
        var div = L.DomUtil.create('div', 'leaflet-control-layers leaflet-control-layers-expanded clock');
        div.innerHTML = '--:--:--';
        return div;
    };
    control.update = function () {
        var datetime = new Date();
        var hh = ('0' + datetime.getHours()).slice(-2);
        var mm = ('0' + datetime.getMinutes()).slice(-2);
        var ss = ('0' + datetime.getSeconds()).slice(-2);
        control.getContainer().innerHTML = hh + ':' + mm + ':' + ss;
    };
    return control;
}

// Legend management
function get_legend() {
    var legend = L.control({
        position: 'topleft'
    });
    legend.onAdd = function () {
        var div = L.DomUtil.create('div', 'leaflet-control-layers leaflet-control-layers-expanded ledgend');
        add_button(div, 'actual', 'Actual speed');
        add_button(div, 'normal', 'Normal speed');
        add_button(div, 'relative', 'Speed relative to normal');
        var key = L.DomUtil.create('div', 'ledgend-key', div);
        key.id = 'ledgend-key';
        set_ledgend_key(key);
        return div;
    };
    return legend;
}

function add_button(parent, value, html) {
    var label = L.DomUtil.create('label', 'ledgend-label', parent);
    var button = L.DomUtil.create('input', 'ledgend-button', label);
    button.type = 'radio';
    button.name = 'display_type';
    button.value = value;
    if (speed_display === value) {
        button.checked = 'checked';
    }
    var span = L.DomUtil.create('span', 'ledgend-button-text', label);
    span.innerHTML = html;
    L.DomEvent.disableClickPropagation(button);
    L.DomEvent.on(button, 'click', display_select, button);
}

function display_select() {
    speed_display = this.value;
    set_ledgend_key(document.getElementById('ledgend-key'));
    update_line_colours();
}

function set_ledgend_key(element) {
    var colours;
    if (speed_display === 'relative') {
        colours =
            `<span style="color: ${FAST_COLOUR}">GREEN</span>: speed is at least 20% above normal<br>` +
            `<span style="color: ${NORMAL_COLOUR}">BLUE</span>: speed close to normal<br>` +
            `<span style="color: ${SLOW_COLOUR}">RED</span>: speed is at least 20% below normal<br>` +
            `<span style="color: ${BROKEN_COLOUR}">GREY</span>: no speed reported`;
    } else {
        colours =
            `<span style="color: ${FAST_COLOUR}">GREEN</span>: above 20 mph<br>` +
            `<span style="color: ${MEDIUM_COLOUR}">AMBER</span>: between 10 and 20 mph<br>` +
            `<span style="color: ${SLOW_COLOUR}">RED</span>: between 5 and 10 mph<br>` +
            `<span style="color: ${VERY_SLOW_COLOUR}">DARK RED</span>: below 5 mph <br>` +
            `<span style="color: ${BROKEN_COLOUR}">GREY</span>: no speed reported<br>`;
    }
    element.innerHTML = '<div class="ledgend-colours">' + colours + '</div>' +
        '<div class="ledgend-common">Traffic drives on the left. Updates every 60s.</div>';
}

// Find an object from a list of objects by matching each object's 'id'
// attribute with the supplied 'id'. Could build/use lookup tables instead?
function find_object(list, id) {

    for (var i = 0; i < list.length; ++i) {
        var object = list[i];
        if (object.id === id) {
            return object;
        }
    }
    console.log('Failed to find object with id ', id);
    return undefined;
}



var voronoi, adjustedSites, vertices, DATA;
var travelTimes;
var travelSpeed;
var historicSpeed;
var speedDeviation;
var selected=[];

function voronoiMap() {

    travelTimes=[];
    travelSpeed=[];
    historicSpeed=[];
    speedDeviation=[];
    InitialiseNodes("speed deviation");
    for (let i = 0; i < SITE_DB.length; i++) {
        travelTimes.push(SITE_DB[i].travelTime);
        travelSpeed.push(SITE_DB[i].travelSpeed);
        historicSpeed.push(SITE_DB[i].travelSpeed);
        speedDeviation.push(SITE_DB[i].speedDeviation);
    }
    selected =speedDeviation;

    var pointTypes = d3.map(),
        points = [],
        lastSelectedPoint;


    voronoi = d3.voronoi().extent([
        [0, 0],
        [2000, 2000]
    ]); //[400, 270], [1020, 720]12 zoom

    showHide = function (selector) {
        d3.select(selector).select('.hide').on('click', function () {
            d3.select(selector)
                .classed('visible', false)
                .classed('hidden', true);
        });

        d3.select(selector).select('.show').on('click', function () {
            d3.select(selector)
                .classed('visible', true)
                .classed('hidden', false);
        });
    }

    var selectPoint = function () {
        d3.selectAll('.selected').classed('selected', false);

        var cell = d3.select(this),
            point = cell.datum();

        lastSelectedPoint = point;
        cell.classed('body', true);

        d3.select('body')
            .html('')
            .append('a')
            .text("hover")
            //.attr('href', point.url)
            .attr('target', '_blank')
    }

    var drawPointTypeSelection = function () {
        showHide('#selections')
        labels = d3.select('#toggles').selectAll('input')
            .data(pointTypes.values())
            .enter().append("label");

        labels.append("input")
            .attr('type', 'checkbox')
            .property('checked', function (d) {
                return initialSelections === undefined || initialSelections.has(d.type)
            })
            .attr("value", function (d) {
                return d.type;
            })
            .on("change", drawWithLoading);

        labels.append("span")
            .attr('class', 'key')
            .style('background-color', function (d) {
                return '#' + d.color;
            });

        labels.append("span")
            .text(function (d) {
                return d.type;
            });
    }

    var selectedTypes = function () {
        return d3.selectAll('#toggles input[type=checkbox]')[0].filter(function (elem) {
            return elem.checked;
        }).map(function (elem) {
            return elem.value;
        })
    }

    var pointsFilteredToSelectedTypes = function () {
        var currentSelectedTypes = d3.set(selectedTypes());
        return points.filter(function (item) {
            return currentSelectedTypes.has(item.type);
        });
    }

    var drawWithLoading = function (e) {
        d3.select('#loading').classed('visible', true);
        if (e && e.type == 'viewreset') {
            d3.select('#overlay').remove();
        }
        setTimeout(function () {
            draw();
            d3.select('#loading').classed('visible', false);
        }, 0);
    }


    var draw = function () {

        var bounds = map.getBounds(),
            topLeft = map.latLngToLayerPoint(bounds.getNorthWest()),
            bottomRight = map.latLngToLayerPoint(bounds.getSouthEast()),
            existing = d3.set(),
            drawLimit = bounds.pad(0.4);

        vertices = [];

        adjustedSites = all_sites.filter(function (d) {
            var latlng = new L.LatLng(d.location.lat, d.location.lng);
            // console.log(latlng);
            if (!drawLimit.contains(latlng)) {
                return false
            };

            var point = map.latLngToLayerPoint(latlng);

            key = point.toString();
            if (existing.has(key)) {
                return false
            };
            existing.add(key);

            d.x = point.x;
            d.y = point.y;

            vertices.push([d.x, d.y]);
            return true;
        });

        console.log("min_max ",Math.min(...selected), Math.max(...selected));

        var newColor = d3.scaleSequential().domain([Math.min(...selected), Math.max(...selected)])
            .interpolator(d3.interpolateRdYlGn);

        var c10 = d3.schemePaired;

        var svg = d3.select(map.getPanes().overlayPane).append("svg") //body
            .attr('id', 'overlay')
            //.attr("z-index", 9999)
            //.attr("position", "absolute")
            .attr("class", "leaflet-zoom-hide")
            //.style('background-color', 'rgba(255,0,0,0.0)')
            .style("width", map.getSize().x + 'px')
            .style("height", map.getSize().y + 'px')
            .style("margin-left", topLeft.x + "px")
            .style("margin-top", topLeft.y + "px")
            .style('opacity', 1)
        // .style('fill', 'rgba(255,0,0,0.0)')//function(d) { return '#FFFFFF'} )
        ;

        var g = svg.append("g")
            .attr("transform", "translate(" + (-topLeft.x) + "," + (-topLeft.y) + ")");

        var svgPoints = g.attr("class", "points")
            .selectAll("g")
            .data(voronoi.polygons(vertices))
            .enter().append("g")
            .attr("class", "point");

        //   var polygon = function(point) {
        //     return "M" + point.cell.join("L") + "Z";
        //   }

        function polygon(d) {
            return "M" + d.join("L") + "Z";
        }

        //       path.data( voronoi.polygons(vertices)  ).enter().append("path")
        //       .attr("stroke","white") 
        //       .attr("fill", function(d,i) {return c10[i % 10]} )
        // //    .attr("d", function(d) { return "M" + d.join("L") + "Z" } );
        //     .attr("d", polygon);





        svgPoints.append("path")
            .attr("class", "point-cell")
            .attr("d", polygon)
            .on('click', selectPoint)
            .attr('stroke-width', 1)
            .attr('stroke', "black")
            .attr('fill', function (d, i) { //console.log("\ni",i);
                let color=SITE_DB[i].node_data;
                if(color==null){
                    return "rgb(50,50,50);"
                }
                else{ return newColor(color) //c10[i % 10]
                }
            
                //myColor(i)

            })

            // fetch_value(filteredPoints[i].id)
            //.attr("fill", function(d,i) {return c10[i % 10]} )
            .style('opacity', 0.3)
            .classed("selected", function (d) {
                return lastSelectedPoint == d
            });

        svgPoints.append("circle")
            .attr("transform", function (d, i) {
                return "translate(" + vertices[i][0] + "," + vertices[i][1] + ")";
            })
            .attr('id', function (d, i) {
                return adjustedSites[i].name + " time: " + SITE_DB[i].travelTime + " speed: " + SITE_DB[i].travelSpeed+ " speed: " + SITE_DB[i].speedDeviation
            })
            .style('fill', function (d) {
                return 'black'
            }) //+d.color
            .attr("opacity", 0.4)
            .attr("r", 5);


        d3.selectAll("path")
            // .data(dataset)
            // .enter()
            // .append("circle")
            // .attr(circleAttrs)  // Get attributes from circleAttrs var
            .on("mouseover", handleMouseOver)
            .on("mouseout", handleMouseOut);


        // Create Event Handlers for mouse
        function handleMouseOver(d, i) { // Add interactivity

            // Use D3 to select element, change color and size
            d3.select(this).attr({
                fill: "black",
                r: 10
            });

            console.log(this);
        }

        function handleMouseOut(d, i) {
            // Use D3 to select element, change color back to normal
            d3.select(this).attr({
                fill: "black",
                opacity:0.5,
                r: 5
            });
            console.log(this);
        }
    }


    var mapLayer = {
      onAdd: function(map) {
        map.on('viewreset moveend', drawWithLoading);
        drawWithLoading();
      }
    };


    draw();
}

function InitialiseNodes() {
    for (let i = 0; i < all_sites.length; i++) {
        SITE_DB.push(new Node(all_sites[i].id));
    }

    for (let i = 0; i < SITE_DB.length; i++) {
        SITE_DB[i].findNeighbors();
        SITE_DB[i].computeTravelTime();
        SITE_DB[i].computeTravelSpeed();
        SITE_DB[i].setVisualisation("speed deviation");//speed deviation//travel speed
        
    }
}

class Node {
    constructor(id) {
        this.id = id;
        this.neighbors = [];
        this.travelTime = null;
        this.travelSpeed = null;
        this.historicSpeed = null;
        this.speedDeviation = null;
        this.node_data = null;
        //change later as this will waster resources
       // this.sites = all_sites;
        //this.links = all_links;
        //this.traffic = traffic_data;
    }
    setVisualisation(vis){
        switch(vis)
        {
            case "travel time":
                this.node_data=this.travelTime;
                break;
            case "travel speed":
                this.node_data=this.travelSpeed;
                break;
            case "speed deviation":
                this.node_data=this.speedDeviation;
                break;
            default:
                this.node_data=null;//this.travelSpeed;
                break;

        }
        //this.visualise=vis;
    }
    getLocation() {
        let data = all_sites;//"this.sites;
        for (let i = 0; i < data.length; i++) {
            if (this.id == data[i].id) {
                return {
                    "x": data[i].x,
                    "y": data[i].y
                }
            }
        }
    }
    findNeighbors() //data is all_links
    {
        let data = all_links;//this.links;
        this.neighbors = [];
        for (let i = 0; i < data.length; i++) {
            if (this.id == data[i].sites[1]) {
                this.neighbors.push({
                    "link": data[i].id,
                    "id": data[i].sites[0],
                    "dist":data[i].length
                });
            }
        }
    }

    computeTravelTime() {
        let avg = [];
        let sum = 0;
        for (let i = 0; i < this.neighbors.length; i++) {
            let link = this.neighbors[i].link;

            for (let u = 0; u < traffic_data.length; u++) {
                if (link == traffic_data[u].id) {
                    avg.push(traffic_data[u].travelTime);
                }
            }
        }

        for (let i = 0; i < avg.length; i++) {
            sum += avg[i];
        }
        this.travelTime = sum / avg.length;
    }

    computeTravelSpeed() {
        let currentAverage = [];
        let historicAverage = [];

        for (let i = 0; i < this.neighbors.length; i++) {
            let link = this.neighbors[i].link;
            let dist= this.neighbors[i].dist; 

            for (let u = 0; u < traffic_data.length; u++) {
                if (link == traffic_data[u].id) {
                    let travelTime=traffic_data[u].travelTime;
                    let historicTime=traffic_data[u].normalTravelTime;

                    let currentSpeed = (dist / travelTime) * TO_MPH;
                    let historicSpeed = (dist / historicTime) * TO_MPH;
            
                    if(currentSpeed==Infinity || historicSpeed==Infinity){
                        break;}
                    
                    historicAverage.push(historicSpeed);
                    currentAverage.push(currentSpeed);
                }
            }
        }
        let historicSum = historicAverage.reduce((previous, current) => current += previous);
        this.historicSpeed= historicSum / historicAverage.length;

        let currentSum = currentAverage.reduce((previous, current) => current += previous);
        this.travelSpeed = currentSum / currentAverage.length;

        this.speedDeviation =  this.travelSpeed-this.historicSpeed;

    }
}