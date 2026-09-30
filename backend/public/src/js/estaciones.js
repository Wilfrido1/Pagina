document.addEventListener('DOMContentLoaded', function() {
    fetch('/estaciones')
        .then(response => response.json())
        .then(estaciones => {
            const container = document.querySelector('.estaciones-container');
            if (estaciones.length === 0) {
                container.innerHTML = '<p>No hay estaciones disponibles.</p>';
                return;
            }
            estaciones.forEach(estacion => {
                const estacionCard = document.createElement('div');
                estacionCard.className = 'estacion-card';
                let sensorsHTML = estacion.sensores.map(sensor => `
                    <li>${sensor.tipo}: ${sensor.ultima_lectura || 'Sin datos'} (Última lectura el ${sensor.ultima_fecha_hora || 'desconocida'})</li>
                `).join('');
                estacionCard.innerHTML = `
                    <h2>${estacion.nombre}</h2>
                    <ul>${sensorsHTML}</ul>
                `;
                container.appendChild(estacionCard);
            });
        })
        .catch(error => {
            console.error('Error al cargar estaciones:', error);
            const container = document.querySelector('.estaciones-container');
            container.innerHTML = '<p>Error al cargar los datos de las estaciones.</p>';
        });
});
