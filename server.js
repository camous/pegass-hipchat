var request = require("request");
var Promise = require('promise');
var rp = require('request-promise');
var _ = require('lodash');
var Hipchat = require('hipchatter');
var settings = require('./settings');

var hipchat = new Hipchat(process.env['HIPCHATKEY']);

var remote_activities = {}
var registers = {}
var promises = [];

function processActivities(activities) {
    console.log(activities.length + ' activities retrieved ...');
    for (var activityId in activities) {
        var activity = activities[activityId];

        for (var roundId in activity.seanceList) {
            var round = activity.seanceList[roundId];
            remote_activities[round.id] = {
                'name': activity.libelle,
                'start': round.debut, 'end': round.fin, 'owner': activity['responsable'] != undefined ? activity.responsable.id : null
            };
            promises.push(processRegisters(round.id));

        }
    }

    Promise.all(promises).then(function (data) {

        // let gather all nivol and get a distinct list
        for (var activityId in remote_activities) {
            for (var registerId in remote_activities[activityId].registers) {
                var id = remote_activities[activityId].registers[registerId].nivol;

                if (registers[id] == undefined)
                    registers[id] = "";
            }
        }

        promises = []

        for (var registerId in registers) {
            processRegister(registerId);
        }

        Promise.all(promises).then(function (data) {
            compareRooms();
        });
    });
}

function processRegister(registerId) {
    var query = {
        method: 'GET',
        url: process.env['BASEURI'] + 'moyencomutilisateur?utilisateur=' + registerId,
        json: true,
        headers: {
            'cache-control': 'no-cache',
            'cookie': process.env['PEGASSKEY']
        }
    };

    promises.push(
        rp(query).then(function (communications) {

            var emailFound = false;
            for (var comId in communications) {
                var com = communications[comId];

                if (com.moyenComId == 'MAILDOM' && registers[com.utilisateurId] == "") {
                    var email = com.libelle;

                    if (process.env['PILOTUSERS'].indexOf(email) == -1)
                        email = process.env['PILOTFAKEGMAIL'].replace('%%email%%', email.replace('@', ''));

                    registers[com.utilisateurId] = email;
                    //console.log(com.utilisateurId + ' = ' + email);
                    emailFound = true;
                }
            }

            if (!emailFound)
                console.log('MAILDOM for ' + com.utilisateurId + ' not found');

        }).catch(function (err) {
            console.log(err);
        })
    );

}

function processRegisters(roundId) {
    var query = {
        method: 'GET',
        json: true,
        url: process.env['BASEURI'] + 'seance/' + roundId + '/inscription',
        headers:
        {
            'cache-control': 'no-cache',
            'cookie': process.env['PEGASSKEY']
        }
    };

    promises.push(
        rp(query).then(function (data) {

            var activity = remote_activities[roundId];
            activity['registers'] = [];
            if (activity.owner != null && activity['registers'].indexOf(activity.owner) == -1)
                activity['registers'].push({ 'nivol': activity.owner });

            for (var registerId in data) {
                var register = data[registerId];
                activity['registers'].push({ 'nivol': register.utilisateur.id });
            }
        }));
}

function compareRooms() {
    hipchat.rooms(function (err, rooms) {
        for (var activityId in remote_activities) {
            var activity = remote_activities[activityId];
            var existingRooms = _.filter(rooms, x => x.name.indexOf(activityId) !== -1)

            var roomname = activity.name.substring(0, 50 - (activityId.length + 2));

            if (existingRooms.length == 0) {
                hipchat.create_room({
                    'guest_access': false,
                    'name': roomname + ' #' + activityId,
                    'owner_user_id': 4227537,
                    'privacy': 'private'
                }, function (err, room_details) {
                    console.log(roomname + ' created');

                    updateTopic(room_details.entity, activity);
                    synchronizeMembers(room_details.entity, activity.registers);
                });
            } else {
                updateTopic(existingRooms[0], activity);
                synchronizeMembers(existingRooms[0], activity.registers);
            }
        }
    });

}

function updateTopic(room, activity) {
    hipchat.set_topic(room.id, activity.start + ' à ' + activity.end);
}

function synchronizeMembers(room, members) {
    for (var memberId in members) {
        var email = registers[members[memberId].nivol];
        hipchat.add_member({ 'room_name': room.id, 'user_email': email }, function (member_details) {
            if (member_details != null && member_details.message != undefined)
                console.log(member_details.message);
            else
                console.log(email + ' added on ' + room.name);
        });
    }
}

//get all activities by sevres structure
var activitiesQuery = {
    method: 'GET', json: true,
    url: process.env['BASEURI'] + 'activite?debut=2016-08-01&fin=2016-08-31&structure=1179',
    headers:
    {
        'cache-control': 'no-cache',
        'cookie': process.env['PEGASSKEY']
    }
};

request(activitiesQuery, function (error, response, body) {
    if (error) throw new Error(error);
    processActivities(body);

});

