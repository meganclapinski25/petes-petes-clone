// MODELS
const Pet = require('../models/pet');
const mailer = require('../utils/mailer');

// UPLOADING TO AWS S3
const multer  = require('multer');
const upload = multer({ dest: 'uploads/' });
const Upload = require('s3-uploader');

const client = new Upload(process.env.S3_BUCKET, {
  aws: {
    path: 'pets/avatar',
    region: process.env.S3_REGION,
    acl: 'public-read',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  },
  cleanup: {
    versions: true,
    original: true
  },
  versions: [{
    maxWidth: 400,
    aspect: '16:10',
    suffix: '-standard'
  },{
    maxWidth: 300,
    aspect: '1:1',
    suffix: '-square'
  }]
});

// PET ROUTES
module.exports = (app) => {

  // INDEX PET => index.js

  // NEW PET
  app.get('/pets/new', (req, res) => {
    res.render('pets-new');
  });

  // CREATE PET
  app.post('/pets', upload.single('avatar'), (req, res, next) => {
    var pet = new Pet(req.body);
    pet.save()
      .then(() => {
        if (req.file) {
          // Upload the images
          client.upload(req.file.path, {}, function (err, versions, meta) {
            if (err) { return res.status(400).send({ err: err }) };

            // Pop off the -square and -standard and just use the one URL to grab the image
            versions.forEach(function (image) {
              var urlArray = image.url.split('-');
              urlArray.pop();
              var url = urlArray.join('-');
              pet.avatarUrl = url;
              pet.save();
            });

            res.send({ pet: pet });
          });
        } else {
          res.send({ pet: pet });
        }
      })
      .catch((err) => {
        console.error('Error saving pet:', err);
        console.error('Validation errors:', err.errors);
        if (err.name === 'ValidationError') {
          const validationErrors = Object.keys(err.errors).map(key => ({
            field: key,
            message: err.errors[key].message
          }));
          console.error('Detailed validation errors:', validationErrors);
        }
        res.status(400).send({ err: err.message || err });
      });
  });

  // SHOW PET
  app.get('/pets/:id', (req, res) => {
    Pet.findById(req.params.id).exec()
      .then((pet) => {
        res.render('pets-show', { pet: pet });
      })
      .catch((err) => {
        console.error('Error finding pet:', err);
        res.status(404).render('error', { message: 'Pet not found', error: err });
      });
  });

  // EDIT PET
  app.get('/pets/:id/edit', (req, res) => {
    Pet.findById(req.params.id).exec()
      .then((pet) => {
        res.render('pets-edit', { pet: pet });
      })
      .catch((err) => {
        console.error('Error finding pet for edit:', err);
        res.status(404).render('error', { message: 'Pet not found', error: err });
      });
  });

  // SEARCH PET
  app.get('/search', function (req, res) {
    Pet
        .find(
            { $text : { $search : req.query.term } },
            { score : { $meta: "textScore" } }
        )
        .sort({ score : { $meta : 'textScore' } })
        .limit(20)
        .exec()
        .then((pets) => {
          if (req.header('Content-Type') == 'application/json') {
            return res.json({ pets: pets });
          } else {
            return res.render('pets-index', { pets: pets, term: req.query.term });
          }
        })
        .catch((err) => {
          console.error('Search error:', err);
          return res.status(400).send(err);
        });
  });

  // UPDATE PET
  app.put('/pets/:id', (req, res) => {
    Pet.findByIdAndUpdate(req.params.id, req.body)
      .then((pet) => {
        res.redirect(`/pets/${pet._id}`)
      })
      .catch((err) => {
        // Handle Errors
      });
  });

  // PURCHASE
  app.post('/pets/:id/purchase', (req, res) => {
    console.log(req.body);
    var stripe = require("stripe")(process.env.PRIVATE_STRIPE_API_KEY);

    const token = req.body.stripeToken;
    let petId = req.body.petId || req.params.id;

    Pet.findById(petId).exec()
      .then((pet) => {
        if (!pet) {
          console.log('Pet not found');
          return res.redirect(`/pets/${req.params.id}`);
        }
        if (!pet.price || isNaN(pet.price)) {
          console.log('Invalid pet price:', pet.price);
          return res.redirect(`/pets/${req.params.id}`);
        }
        const charge = stripe.charges.create({
          amount: Math.round(pet.price * 100),
          currency: 'usd',
          description: `Purchased ${pet.name}, ${pet.species}`,
          source: token,
        }).then((chg) => {
          // Convert the amount back to dollars for ease in displaying in the template
          const user = {
            email: req.body.stripeEmail,
            amount: chg.amount / 100,
            petName: pet.name
          };
          // Call our mail handler to manage sending emails
          mailer.sendMail(user, req, res);
        })
        .catch(err => {
          console.log('Error: ' + err);
        });
      })
      .catch((err) => {
        console.log('Error: ' + err);
        res.redirect(`/pets/${req.params.id}`);
      });
  });

  // DELETE PET
  app.delete('/pets/:id', (req, res) => {
    Pet.findByIdAndDelete(req.params.id).exec()
      .then((pet) => {
        return res.redirect('/');
      })
      .catch((err) => {
        console.error('Error deleting pet:', err);
        return res.redirect('/');
      });
  });
};