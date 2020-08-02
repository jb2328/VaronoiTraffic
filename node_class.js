class Node {
    constructor(id) {

        this.id = id;
        this.name = null;

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

        this.getName();
    }

    getName() {
        for (let i = 0; i < all_sites.length; i++) {

            if (this.id == all_sites[i].id) {
                this.name = all_sites[i].name;
                break;
            }
        }

    }
    fetchName(id) {
        for (let i = 0; i < all_sites.length; i++) {

            if (id == all_sites[i].id) {
                //this.name = all_sites[i].name;
                return all_sites[i].name;
            }
        }

    }
    setVisualisation(vis) {
        this.selectedName = vis;
        switch (vis) {
            case "historic speed":
                this.selected = this.historicSpeed;
                break;
            case "travel speed":
                this.selected = this.travelSpeed;
                break;
            case "speed deviation":
                this.selected = this.speedDeviation;
                break;
            default:
                this.selected = this.speedDeviation; //this.travelSpeed;
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
        this.neighbors = [];
        let tt,ntt,travelTime;
        for (let i = 0; i < all_links.length; i++) {
            if (this.id == all_links[i].sites[0]) { //from this id
                //console.log('journeysB',journeys[i].id, this.id,data[i])
                //console.log(data.length, journeys.length,i);
                try {
                    tt = journeys.find(x => x.id === all_links[i].id).travelTime;
                    ntt = journeys.find(x => x.id === all_links[i].id).normalTravelTime;
                    travelTime = tt == undefined || null ? ntt : tt;
                   }
                   catch(err) {
                     travelTime=undefined;
                     ntt=undefined;
                   }
               
                //console.log(tt, travelTime);
                let link=findLinks(this.id, all_links[i].sites[1]);
                this.neighbors.push({
                    "links": {"out": link.out,"in":link.in},                 
                    "name": all_links[i].name,
                    "id": all_links[i].sites[1], //to this id
                    "site": this.fetchName(all_links[i].sites[1]),
                    "travelTime": travelTime,
                    "normalTravelTime": ntt,
                    "dist": all_links[i].length
                });
            }
        }
    }
    
    computeTravelTime() {
        let avg = [];
        let sum = 0;
        for (let i = 0; i < this.neighbors.length; i++) {
            let link = this.neighbors[i].links.out.id;

            for (let u = 0; u < journeys.length; u++) {
                if (link == journeys[u].id) {
                    avg.push(journeys[u].travelTime);
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
            let link = this.neighbors[i].links.out.id;
            let dist = this.neighbors[i].dist;

            for (let u = 0; u < journeys.length; u++) {
                if (link == journeys[u].id) {
                    let travelTime = journeys[u].travelTime;
                    let historicTime = journeys[u].normalTravelTime;
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