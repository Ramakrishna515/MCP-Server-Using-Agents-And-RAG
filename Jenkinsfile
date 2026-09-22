pipeline {
    agent { docker { image 'node:22' } }

    options {
        timestamps()
        ansiColor('xterm')
        buildDiscarder(logRotator(numToKeepStr: '10'))
    }

    environment {
        NODE_ENV = 'test'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Environment') {
            steps {
                sh 'node --version && npm --version'
            }
        }

        stage('Install dependencies') {
            steps {
                sh 'npm ci'
            }
        }

        stage('Build') {
            steps {
                sh 'npm run build'
            }
        }

        stage('Test') {
            steps {
                sh 'npm run test'
            }
        }

        stage('Server Smoke Test') {
            steps {
                sh '''
                    set +e
                    node dist/server.js > server.log 2>&1 &
                    SRV=$!
                    sleep 2
                    if grep -q "running on stdio" server.log; then
                      echo "PASS: server started and is listening on stdio"
                      kill $SRV
                    else
                      echo "FAIL: server did not start"
                      cat server.log
                      exit 1
                    fi
                '''
            }
        }

        stage('Web Smoke Test') {
            steps {
                sh '''
                    set +e
                    PORT=3000 node dist/http.js > web.log 2>&1 &
                    WEB=$!
                    OK=0
                    for i in $(seq 1 15); do
                      if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null | grep -q 200; then
                        echo "PASS: web portal responding on :3000"
                        OK=1
                        break
                      fi
                      sleep 1
                    done
                    if [ $OK = 0 ]; then
                      echo "FAIL: web portal did not respond"
                      cat web.log
                      exit 1
                    fi
                    kill $WEB
                '''
            }
        }
    }

    post {
        always {
            cleanWs()
        }
    }
}