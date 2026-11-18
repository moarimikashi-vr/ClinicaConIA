// Contract with the backend IA flow (Backend/src/controllers/caseController.js and
// Backend/api-IAFraturas/main.py). Keep these values in sync with what those services write.

// autorId of the automatic comment the backend posts after each analysis
export const IA_AUTHOR_ID = 'sistema_ia';

// `prediction` labels returned by the IA service (get_prediction_logic)
export const IA_PREDICTION = {
    HEALTHY: 'SANO',
    REVIEW: 'REVISIÓN REQUERIDA',
    FRACTURE: 'FRACTURA DETECTADA',
};
