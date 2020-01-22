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
    voronoi_layer,
    layer_control, // The layer control
    clock, // The clock control
    hilighted_line, // The currently highlighted link or route
    speed_display = 'actual', // Line colour mode - 'actual', 'normal' or 'relative'
    line_map = {}; // Lookup link/route id to displayed polyline


var all_sites, traffic_data = [],
    all_links;

var minmax, myColors;
var SITE_DB = [];

$(document).ready(function () {
    initMap();
    load_data();

});

// Clock
// clock = get_clock().addTo(map);

// Async load locations, annotate with auto-refreshing journey times
function load_data() {

    $.get(LOCATIONS_URL)
        .done(function (locations) {

            // Sites
            all_sites = locations.sites;
            all_links = locations.links

            // Load (and schedule for reload) journey times
            load_journey_times();

        });

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

            }


            // Reset the clock
            //clock.update();

            // Re-schedule for a minute in the future
            setTimeout(load_journey_times, 60000);

            d3.select('svg').remove(); //#overlay
            drawVoronoi();

        });

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


function initMap(){

    var stamenToner = L.tileLayer('http://stamen-tiles-{s}.a.ssl.fastly.net/toner/{z}/{x}/{y}.png', {
        attribution: 'Map tiles by Stamen Design, CC BY 3.0 - Map data © OpenStreetMap',
        subdomains: 'abcd',
        minZoom: 0,
        maxZoom: 20,
        ext: 'png'
    });
    var cambridge = new L.LatLng(52.20038, 0.1197);
     map = new L.Map("map", {
        center: cambridge,
        zoom: 13,
        layers: [stamenToner],
    });
    
    var info = L.control();
    
    info.onAdd = function (map) {
        this._div = L.DomUtil.create('div', 'info');
        this.update();
        return this._div;
    };
    
    info.update = function (e) {
        if (e === undefined) {
            this._div.innerHTML = '<h4>Information</h4>';
            return;
        }
        // this._div.innerHTML = '<h4>Informations</h4>'
        // 	+  '<span style="font-weight:bold;">' + e.airport
        // 	+  '</span><br/>Code OACI : <span style="font-weight:bold;">' + e.oaci_code
        // 	+  '</span><br/>Longueur de piste : <span style="font-weight:bold;">' + e.length + ' m'
        // 	+  '</span><br/>Largeur de piste : <span style="font-weight:bold;">' + e.width + ' m'
        // 	+  '</span><br/>Altitude : <span style="font-weight:bold;">' + e.high + ' m' + '</span>'
        ;
    };
    
    info.addTo(map);
    

    map.on("viewreset moveend", drawVoronoi);
    
}


var points = [];
points = all_sites;


var voronoi, adjustedSites, vertices, DATA;
var travelTimes;
var travelSpeed;
var historicSpeed;
var speedDeviation;

function drawVoronoi() {

    travelTimes = [];
    travelSpeed = [];
    historicSpeed = [];
    speedDeviation = [];
    

    // voronoi = d3.voronoi().extent([
    //     [0, 0],
    //     [2000, 2000]
    // ]); 
    
 

    InitialiseNodes("speed deviation");

    for (let i = 0; i < SITE_DB.length; i++) {
        travelTimes.push(SITE_DB[i].travelTime);
        travelSpeed.push(SITE_DB[i].travelSpeed);
        historicSpeed.push(SITE_DB[i].travelSpeed);
        speedDeviation.push(SITE_DB[i].speedDeviation);
    }

    var bounds = map.getBounds(),
        topLeft = map.latLngToLayerPoint(bounds.getNorthWest()),
        bottomRight = map.latLngToLayerPoint(bounds.getSouthEast()),
        drawLimit = bounds.pad(0.4);

    filteredPoints = all_sites.filter(function (d,i) {
        var latlng = new L.latLng(+d.location.lat, +d.location.lng);
        if (!drawLimit.contains(latlng)) {
            return false
        };

        var point = map.latLngToLayerPoint(latlng);
        d.x = point.x;
        d.y = point.y;

        SITE_DB[i].x = d.x;
        SITE_DB[i].y = d.y;
        SITE_DB[i].lat = d.location.lat;
        SITE_DB[i].lng = d.location.lng;

        return true;
    });

    let findMax = (ma, v) => Math.max(ma, v.selected)
    let findMin = (mi, v) => Math.min(mi, v.selected)
    let max = SITE_DB.reduce(findMax, -Infinity)
    let min = SITE_DB.reduce(findMin, Infinity)

    console.log("new min_max ", min, max);

    var newColor = d3.scaleSequential().domain([min, max])//min, max
        .interpolator(d3.interpolateRdYlGn);

    // var maxLength = d3.max(filteredPoints, function (e) {
    //     return +e.length;
    // });
    // var color = d3.scaleLinear()
    //     .domain([0, maxLength])
    //     .range(['rgb(255,245,235)', 'rgb(127,39,4)']);

    var voronoi = d3.voronoi()
        .x(function (d) {
            return d.x;
        })
        .y(function (d) {
            return d.y;
        })
        .extent([
            [topLeft.x, topLeft.y],
            [bottomRight.x, bottomRight.y]
        ]); // To get all points included, change from previous version

    var voronoiPolygons = voronoi.polygons(filteredPoints);
    var readyVoronoiPolygons = [];
    for (let i = 0; i < voronoiPolygons.length; ++i) {
        if (voronoiPolygons[i] !== undefined) {
            readyVoronoiPolygons.push(voronoiPolygons[i]);
        }
    }

    d3.select("svg").remove();
    var svg = d3.select(map.getPanes().overlayPane).append("svg")
        .attr("id", "overlay")
        .attr("class", "leaflet-zoom-hide")
        .style("width", map.getSize().x + "px")
        .style("height", map.getSize().y + "px")
        .style("margin-left", topLeft.x + "px")
        .style("margin-top", topLeft.y + "px");

    var pathGroup = svg.append("g")
        .attr("transform", "translate(" + (-topLeft.x) + "," + (-topLeft.y) + ")");
    var cirlceGroup = svg.append("g")
        .attr("transform", "translate(" + (-topLeft.x) + "," + (-topLeft.y) + ")");

    pathGroup.selectAll("cell")
        .data(readyVoronoiPolygons)
        .enter()
        .append("path")
        .attr("class", "cell")
        .attr("d", function (d) {
            return "M" + d.join("L") + "Z"
        })
        .attr('fill', function (d, i) { 
            console.log("\ni",i, SITE_DB[i]);

            let color = SITE_DB[i].selected;
            if (color == null) {
                return "rgb(50,50,50);"
            } else {
                return newColor(color) //c10[i % 10]
            }
        })
        .on("mouseover", function (d) {
            info.update(d.data);
        });

    cirlceGroup.selectAll("circle")
        .data(filteredPoints)
        .enter()
        .append("circle")
        .attr("class", "point")
        .attr("transform", function (d) {
            return "translate(" + d.x + "," + d.y + ")";
        })
        .attr("r", 2);
        console.log("next");
}




function InitialiseNodes() {
    for (let i = 0; i < all_sites.length; i++) {
        SITE_DB.push(new Node(all_sites[i].id));
    }

    for (let i = 0; i < SITE_DB.length; i++) {
        SITE_DB[i].findNeighbors();
        SITE_DB[i].computeTravelTime();
        SITE_DB[i].computeTravelSpeed();
        SITE_DB[i].setVisualisation("speed deviation"); //speed deviation//travel speed

    }
}

class Node {
    constructor(id) {

        this.id = id;

        this.lat = null;
        this.lng = null;
        this.x = null;
        this.y = null;

        this.neighbors = [];

        this.travelTime = null;
        this.travelSpeed = null;
        this.historicSpeed = null;
        this.speedDeviation = null;

        this.selected = null;
        this.selectedName = null;
    }
    setVisualisation(vis) {
        this.selectedName = vis;
        switch (vis) {
            case "travel time":
                this.selected = this.travelTime;
                break;
            case "travel speed":
                this.selected = this.travelSpeed;
                break;
            case "speed deviation":
                this.selected = this.speedDeviation;
                break;
            default:
                this.selected = null; //this.travelSpeed;
                break;

        }
        //this.visualise=vis;
    }
    getLocation() {
        let data = all_sites; //"this.sites;
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
        let data = all_links; //this.links;
        this.neighbors = [];
        for (let i = 0; i < data.length; i++) {
            if (this.id == data[i].sites[0]) { //from this id
                this.neighbors.push({
                    "link": data[i].id,
                    "id": data[i].sites[1], //to this id
                    "dist": data[i].length
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
            let dist = this.neighbors[i].dist;

            for (let u = 0; u < traffic_data.length; u++) {
                if (link == traffic_data[u].id) {
                    let travelTime = traffic_data[u].travelTime;
                    let historicTime = traffic_data[u].normalTravelTime;
                    // console.log(historicTime);

                    let currentSpeed = (dist / travelTime) * TO_MPH;
                    let historicSpeed = (dist / historicTime) * TO_MPH;

                    if (currentSpeed == Infinity || historicSpeed == Infinity) {
                        break;
                    }

                    historicAverage.push(historicSpeed);
                    currentAverage.push(currentSpeed);
                }
            }
            //console.log(historicAverage);

        }
        if (historicAverage.length > 0) {
            let historicSum = historicAverage.reduce((previous, current) => current += previous);
            this.historicSpeed = historicSum / historicAverage.length;
        }

        if (currentAverage.length > 0) {
            let currentSum = currentAverage.reduce((previous, current) => current += previous);
            this.travelSpeed = currentSum / currentAverage.length;
        }


        this.speedDeviation = this.travelSpeed - this.historicSpeed;

    }
}