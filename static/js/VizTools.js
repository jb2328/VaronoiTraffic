"use strict";


class VizTools {

    // Called to create instance in page : space_floorplan = SpaceFloorplan()
    constructor() {

        this.ICON_CLOSE_DIV = "<span id='close' onclick='this.parentNode.style.opacity=0; return false;'>x</span>"
        this.ICON_CLOSE_AND_DESELECT = "<span id='close' onclick='this.parentNode.style.opacity=0; deselect_all(); this.SELECTED_SITE=undefined; return false;'>x</span>"

        this.ICON_LOADING = '<img src="./static/images/loading_icon.gif "width="100px" height="100px" >';

        this.HALF_TAB = '&emsp;&emsp;'
        this.TAB = '&emsp;&emsp;&emsp;&emsp;'

    }




    find_lat_lng(map_object) {
        map_object.on('click',
            function (e) {
                var coord = e.latlng.toString().split(',');
                var lat = coord[0].split('(');
                var lng = coord[1].split(')');
                console.log("You clicked the map at latitude: " + lat[1] + " and longitude:" + lng[0]);
            });
    }

    arrays_equal(a, b) {
        if (a === b) return true;
        if (a == null || b == null) return false;
        if (a.length != b.length) return false;

        // If you don't care about the order of the elements inside
        // the array, you should sort both arrays here.
        // Please note that calling sort on an array will modify that array.
        // you might want to clone your array first.

        for (var i = 0; i < a.length; ++i) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    to_timestamp(str_date) {
        let datum = Date.parse(str_date);
        return datum / 1000;
    }


    //a general mapping function that takes a value and interpolates it
    //in a different range
    map_values(value, start1, stop1, start2, stop2) {
        let result = start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));

        if (result > start2) {
            result = start2;
        }
        if (result < start1) {
            result = start1;
        }
        return result;
    }

}

 // Instantiate a jb2328 utility class e.g. for getBoundingBox()
 var viz_tools = new VizTools();